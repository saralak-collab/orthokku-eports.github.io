function createLegacyDatabaseUI({getAdminToken, escapeHtml, renderSheetTabsList, setSyncStatus, syncDown, setRevision, flushPendingSaves}){
  const v3Ui = {
    fields:{targetId:'sheet-id-input',targetDb:'v3-target-db',targetDr:'v3-target-dr',legacyDbId:'v3-legacy-db-id',legacyDrId:'v3-legacy-dr-id',legacyDb:'v3-legacy-db',legacyDr:'v3-legacy-dr'},
    config:null, job:null, busy:false, analysis:null, session:''
  };
  const v3Phases = {
    connecting:'กำลังเชื่อมต่อต้นฉบับ', reading:'กำลังอ่าน DB และ DR · ประกอบ JSON · ตรวจสอบและจัดหมวดหมู่',
    preview:'ตรวจสอบรายการด้านล่างก่อนยืนยัน', staging:'กำลังบันทึกลง Staging', verifying:'กำลังตรวจจำนวน Record และ Checksum',
    activating:'กำลังตรวจความสัมพันธ์และเปิดใช้ฐานข้อมูล', completed:'อัปเดตข้อมูลและตรวจสอบการบันทึกแล้ว',
    cancelled:'ยกเลิกงานแล้ว', failed:'งานนำเข้าล้มเหลว'
  };
  const v3Counts = {db:'อ่านจาก DB',dr:'อ่านจาก DR',added:'เพิ่มใหม่',updated:'อัปเดต',unchanged:'ไม่เปลี่ยนแปลง',duplicates:'ข้อมูลซ้ำ',conflicts:'Conflict',errors:'ข้อผิดพลาด',missing:'Missing from Source',archived:'ฟิลด์ที่เก็บเพื่อกู้คืน',archivedSnapshots:'สำเนาต้นฉบับ'};
  const v3IssueLabels = {duplicate:'ข้อมูลซ้ำ',invalid:'ข้อผิดพลาด',conflict:'Conflict',missing:'Missing from Source',unmapped:'เก็บเพื่อกู้คืน'};
  const v3ActivePhases = ['staging','verifying','activating'];
  const v3El = id => document.getElementById(id);

  function v3Rpc(name,...args){
    const token=getAdminToken();
    return new Promise((resolve,reject)=>{
      if(typeof google==='undefined'||!token){
        reject(new Error('กรุณาเข้าสู่ระบบ Admin'));return;
      }
      google.script.run.withSuccessHandler(value=>{
        if(token!==getAdminToken()){reject(new Error('Session เปลี่ยนแล้ว'));return;}
        resolve(value);
      }).withFailureHandler(error=>reject(new Error(error.message||'ติดต่อ Server ไม่สำเร็จ')))[name](token,...args);
    });
  }

  function v3Status(message,error=false){
    const el=v3El('v3-status');
    el.textContent=message;
    el.style.color=error?'var(--red)':'var(--text2)';
  }

  function v3Enabled(){
    const configured=Boolean(v3Ui.config?.legacyDbId||v3Ui.config?.legacyDrId);
    const target=Boolean(v3Ui.config?.targetId);
    const phase=v3Ui.job?.phase;
    const active=v3ActivePhases.includes(phase);
    ['v3-test-legacy','v3-analyze','v3-schema'].forEach(id=>v3El(id).disabled=v3Ui.busy||!configured);
    ['v3-preview','v3-start'].forEach(id=>v3El(id).disabled=v3Ui.busy||!configured||!target||active);
    ['v3-history','btn-sync-up','btn-sync-down','btn-db-consolidate','btn-check-sheet-id'].forEach(id=>v3El(id).disabled=v3Ui.busy||!target);
    if(active)v3El('btn-db-consolidate').disabled=true;
    v3El('btn-save-sheet-id').disabled=v3Ui.busy||active;
    const actions={'v3-confirm':phase==='preview','v3-resume':active,'v3-cancel':active||['preview','connecting','reading'].includes(phase)};
    Object.entries(actions).forEach(([id,available])=>{
      const button=v3El(id);
      button.hidden=!available;
      button.disabled=!available||v3Ui.busy;
    });
  }

  async function v3Run(callback){
    if(v3Ui.busy)return;
    v3Ui.busy=true;v3Enabled();
    try{await callback();}
    catch(e){v3Status(e.message,true);}
    finally{v3Ui.busy=false;v3Enabled();}
  }

  function v3FillConfig(config){
    v3Ui.config=config;
    Object.entries(v3Ui.fields).forEach(([key,id])=>v3El(id).value=config[key]||'');
    v3El('sheet-id-current').textContent=config.targetId?`ใช้งาน ${config.targetDb} / ${config.targetDr} · ${config.targetId}`:'ยังไม่ได้ตั้งค่าฐานข้อมูลเป้าหมาย';
    if(!config.legacyDbId&&!config.legacyDrId)v3Status('กรอกและบันทึกการตั้งค่าแหล่งข้อมูลเก่าเพื่อเปิดการนำเข้า');
    else v3Status('พร้อมตรวจสอบข้อมูลต้นฉบับ');
    v3Enabled();
  }

  function loadSheetConfig(checkTarget){
    const token=getAdminToken();
    if(typeof google==='undefined'||!token)return;
    if(v3Ui.session===token&&!checkTarget)return;
    v3Run(async()=>{
      v3FillConfig(await v3Rpc('getV3DatabaseSettings'));
      if(checkTarget){
        const result=JSON.parse(await v3Rpc('getSheetConfig',true));
        if(!result.ok)throw new Error(result.message);
        renderSheetTabsList(result.sheetTabs||[]);
        setSyncStatus('✅ เปิดฐานข้อมูลเป้าหมายได้','var(--green)');
      }
      const progress=await v3Rpc('getLegacyUpdateProgress');
      if(progress){
        v3RenderJob(progress);
        if(progress.phase==='preview')await v3PreviewPage(0);
        if(progress.phase==='completed')await v3CompletedReport(progress.id,0);
      }
      else{
        v3Ui.job=null;
        v3El('v3-progress').hidden=true;
        v3El('v3-summary').replaceChildren();
        v3El('v3-detail').replaceChildren();
      }
      v3Ui.session=getAdminToken();
    });
  }

  function saveSheetIdSetting(){
    v3Run(async()=>{
      const configuration=Object.fromEntries(Object.entries(v3Ui.fields).map(([key,id])=>[key,v3El(id).value.trim()]));
      const old=v3Ui.config?.targetId;
      if(old&&configuration.targetId!==old&&!configuration.targetId.includes('/d/'+old+'/')&&!confirm('ต้องการเปลี่ยนไฟล์ฐานข้อมูลที่ใช้งานอยู่หรือไม่?'))return;
      v3Status('กำลังตรวจสอบและบันทึกการตั้งค่า');
      const result=await v3Rpc('saveV3DatabaseSettings',configuration);
      v3Ui.job=null;v3Ui.analysis=null;
      if(old!==result.config.targetId){v3El('v3-report-link').hidden=true;v3El('v3-report-link').removeAttribute('href');}
      v3El('v3-summary').replaceChildren();v3El('v3-detail').replaceChildren();v3El('v3-progress').hidden=true;
      v3FillConfig(result.config);
      renderSheetTabsList(result.sheetTabs||[]);
      setSyncStatus('✅ บันทึกการตั้งค่าฐานข้อมูลแล้ว','var(--green)');
      if(!old||old!==result.config.targetId)syncDown();
      else if(result.revision!==undefined)setRevision(result.revision);
    });
  }

  function v3Table(headers,rows){
    return `<div class="card" style="overflow:auto"><table class="tbl"><thead><tr>${headers.map(v=>`<th>${escapeHtml(String(v))}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${escapeHtml(String(v??''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function v3ShowReport(report,page=0,load=null){
    const summary=v3El('v3-summary');
    const detail=v3El('v3-detail');
    const counts=report.summary;
    summary.innerHTML=counts?`<div style="display:flex;gap:8px 14px;flex-wrap:wrap;font-size:12px">${Object.entries(v3Counts).map(([k,label])=>`<span>${label} <strong>${Number(counts[k]||0).toLocaleString('th-TH')}</strong></span>`).join('')}</div>`:'';
    if(report.completedAt){
      const time=document.createElement('div');time.style.fontSize='12px';time.textContent='อัปเดตเมื่อ '+v3Date(report.completedAt);summary.append(time);
    }
    const issues=report.issues||[];
    detail.innerHTML=issues.length?v3Table(['สถานะ','ต้นฉบับ','ฟิลด์','ลำดับ','รายละเอียด'],issues.map(issue=>[v3IssueLabels[issue.code]||issue.code,issue.source,issue.path,issue.row??'—',issue.message])):'';
    if(load&&report.issueCount>50)v3Pagination(detail,page,report.issueCount,load);
  }

  function v3Pagination(target,page,total,load){
    const controls=document.createElement('div');controls.style='display:flex;gap:8px;align-items:center;margin-top:8px';
    [['ก่อนหน้า',page-1,page===0],['ถัดไป',page+1,(page+1)*50>=total]].forEach(([name,next,disabled])=>{
      const button=document.createElement('button');button.type='button';button.className='abtn';button.textContent=name;button.disabled=disabled;
      button.addEventListener('click',()=>v3Run(()=>load(next)));controls.append(button);
    });
    const label=document.createElement('span');label.textContent=`หน้า ${page+1} / ${Math.max(1,Math.ceil(total/50))}`;controls.append(label);target.append(controls);
  }

  function v3Date(value){return new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});}

  function v3RenderJob(job){
    if(!job?.id||!job.phase)throw new Error('ไม่พบสถานะงานนำเข้า กรุณาเปิดดูตัวอย่างอีกครั้ง');
    v3Ui.job=job;
    v3Status(job.lastError||v3Phases[job.phase]||job.phase,Boolean(job.lastError)||job.phase==='failed');
    const progress=v3El('v3-progress');
    progress.hidden=!['connecting','reading','staging','verifying','activating'].includes(job.phase);
    if(job.total){progress.max=job.total;progress.value=job.processed||0;}
    else progress.removeAttribute('value');
    if(job.phase==='preview')v3ShowReport(job,0,v3PreviewPage);
    else if(['completed','staging','verifying','activating'].includes(job.phase))v3ShowReport(job);
    v3Enabled();
  }

  function v3JobId(phases){
    const job=v3Ui.job;
    if(!job?.id||!phases.includes(job.phase))throw new Error('ยังไม่มีงานนำเข้าสำหรับขั้นตอนนี้ กรุณาเปิดดูตัวอย่างก่อน');
    return job.id;
  }

  async function v3PreviewPage(page){
    const report=await v3Rpc('previewLegacyUpdate',v3JobId(['preview']),page);
    v3ShowReport(report,page,v3PreviewPage);
  }

  async function v3Start(){
    v3RenderJob(await v3Rpc('prepareLegacyUpdate'));
    while(['connecting','reading'].includes(v3Ui.job.phase))v3RenderJob(await v3Rpc('previewLegacyUpdate',v3Ui.job.id,0));
  }

  async function v3Execute(confirmed){
    const id=v3JobId(confirmed?['preview']:v3ActivePhases);
    if(confirmed){
      v3Status('กำลังตรวจ Preview อีกครั้งและเตรียม Staging');
      v3El('v3-progress').hidden=false;v3El('v3-progress').removeAttribute('value');
    }
    do{
      v3RenderJob(await v3Rpc('executeLegacyUpdate',id,confirmed));
      confirmed=false;
      if(v3Ui.job.lastError)return;
    }while(v3ActivePhases.includes(v3Ui.job.phase));
    if(v3Ui.job.phase==='completed'){
      await v3CompletedReport(id,0);
      syncDown();
    }
  }

  async function v3CompletedReport(id,page){
    v3ShowReport(await v3Rpc('getLegacyUpdateReport',id,page),page,next=>v3CompletedReport(id,next));
  }

  async function v3History(page){
    const history=await v3Rpc('getLegacyUpdateHistory',page);
    const detail=v3El('v3-detail');
    v3Status(history.total?'ประวัติการนำเข้า':'ยังไม่มีประวัติการนำเข้า');
    detail.innerHTML=history.items.length?v3Table(['เวลา','สถานะ','เพิ่ม','อัปเดต','Conflict','ข้อผิดพลาด','จัดการ'],history.items.map(item=>[v3Date(item.time),v3Phases[item.action]||(item.action==='rollback'?'กู้คืนแล้ว':item.action),item.summary?.added??'—',item.summary?.updated??'—',item.summary?.conflicts??'—',item.summary?.errors??'—',''])):'';
    detail.querySelectorAll('tbody tr').forEach((row,index)=>{
      const item=history.items[index];
      const actions=row.lastElementChild;
      if(item.action==='completed'){
        const detailButton=document.createElement('button');detailButton.type='button';detailButton.className='abtn';detailButton.textContent='ดูผล';
        detailButton.addEventListener('click',()=>v3Run(()=>v3CompletedReport(item.id,0)));actions.append(detailButton);
      }
      if(item.rollback){
        const button=document.createElement('button');button.type='button';button.className='abtn t';button.textContent='กู้คืนก่อนนำเข้า';
        button.addEventListener('click',()=>v3Run(async()=>{
          if(!confirm('กู้คืนฐานข้อมูลเป็นสถานะก่อนการนำเข้าชุดนี้หรือไม่?'))return;
          await v3Rpc('rollbackLegacyUpdate',item.id);await v3History(0);syncDown();
        }));actions.append(' ',button);
      }
    });
    if(history.total>50)v3Pagination(detail,page,history.total,v3History);
  }

  async function v3Analyze(showSchema){
    v3Status('กำลังอ่านและตรวจสอบโครงสร้าง DB และ DR');
    v3Ui.analysis=await v3Rpc('analyzeLegacyData');
    const data=v3Ui.analysis;
    const counts=data.counts;
    v3ShowReport({summary:{db:counts.db,dr:counts.dr,duplicates:counts.duplicate,errors:counts.errors,archived:counts.unknown},issues:data.issues});
    const structure=Object.entries({DB:data.db,DR:data.dr}).map(([name,source])=>{
      const header=source.header;
      return `<details ${showSchema?'open':''} style="margin:8px 0"><summary>${name} · ${header.chunks} chunks · ${header.chars.toLocaleString('th-TH')} ตัวอักษร${source.schemaVersion?' · Schema '+source.schemaVersion:''}</summary>${v3Table(['JSON path','ชนิดข้อมูล','จำนวนที่พบ'],source.fields.map(row=>[row.path,Object.keys(row.types).join(', '),row.seen]))}${source.truncated?'<p>แสดงโครงสร้างถึงขีดจำกัดการวิเคราะห์</p>':''}</details>`;
    }).join('');
    v3El('v3-detail').insertAdjacentHTML('afterbegin',structure+`<details style="margin:8px 0"><summary>Data Dictionary</summary>${v3Table(data.dictionary[0],data.dictionary.slice(1))}</details>`);
    v3Status('วิเคราะห์ DB และ DR แล้ว');
  }

  function consolidateDbDr(){
    v3Run(async()=>{
      if(!await flushPendingSaves())return;
      setSyncStatus('⏳ กำลังจัดหมวดฐานข้อมูลและสร้างรายงานภาษาไทย','var(--gold)');
      try{
        const result=await v3Rpc('refreshV3DatabaseReports');
        const link=v3El('v3-report-link');
        if(/^https:\/\/docs\.google\.com\/spreadsheets\//.test(result.url||'')){
          link.href=result.url;
          link.hidden=false;
        }
        const notes=result.textIssues?` · พบ ${result.textIssues} แถวที่ควรตรวจอักขระ` : '';
        setSyncStatus(`✅ อัปเดตรายงานภาษาไทย ${result.tabs} แท็บ · รุ่น ${result.revision}${notes}`,result.textIssues?'var(--gold)':'var(--green)');
      }catch(e){setSyncStatus('❌ '+e.message,'var(--red)');throw e;}
    });
  }

  v3El('v3-test-legacy').addEventListener('click',()=>v3Run(async()=>{
    v3Status('กำลังตรวจการเชื่อมต่อและความสมบูรณ์ของ JSON');
    const status=await v3Rpc('testLegacyConnection');
    v3Status(status.map(item=>`${item.label} · ${item.header.chunks} chunks · ${item.tabs} แท็บในไฟล์`).join(' / ')+' · ตรวจสอบสำเร็จ');
  }));
  v3El('v3-analyze').addEventListener('click',()=>v3Run(()=>v3Analyze(false)));
  v3El('v3-schema').addEventListener('click',()=>v3Run(()=>v3Analyze(true)));
  v3El('v3-start').addEventListener('click',()=>v3Run(v3Start));
  v3El('v3-preview').addEventListener('click',()=>v3Run(v3Start));
  v3El('v3-confirm').addEventListener('click',()=>v3Run(()=>v3Execute(true)));
  v3El('v3-resume').addEventListener('click',()=>v3Run(()=>v3Execute(false)));
  v3El('v3-cancel').addEventListener('click',()=>v3Run(async()=>{
    const id=v3JobId([...v3ActivePhases,'preview','connecting','reading']);
    if(!confirm('ยกเลิกงานนำเข้าชุดนี้หรือไม่?'))return;
    v3RenderJob(await v3Rpc('cancelLegacyUpdate',id));
  }));
  v3El('v3-history').addEventListener('click',()=>v3Run(()=>v3History(0)));
  v3Enabled();
  return {loadSheetConfig,saveSheetIdSetting,consolidateDbDr};
}
