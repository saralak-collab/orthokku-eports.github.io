function createExternalElectiveAdmin({getAdminToken,getResidents,units,escapeHtml,flushPendingSaves,onUpdated}){
  let root=null,busy=false,visible=false,page=0,defaults=null;
  const statuses={pending:'รอผู้ประเมิน',submitted:'ส่งผลแล้ว',revoked:'ยกเลิก',expired:'หมดอายุ'};
  const date=value=>new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
  const trainingDate=value=>new Date(value+'T00:00:00Z').toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'});
  const trainingPeriod=item=>item.trainingStart&&item.trainingEnd?trainingDate(item.trainingStart)+' – '+trainingDate(item.trainingEnd):item.assessMonth+'/'+item.assessBEYear;
  function rpc(name,...args){
    const token=getAdminToken();
    return new Promise((resolve,reject)=>{
      if(!token||typeof google==='undefined'){reject(new Error('กรุณาเข้าสู่ระบบ Admin'));return;}
      google.script.run.withSuccessHandler(result=>{
        if(token!==getAdminToken()){reject(new Error('Session เปลี่ยนแล้ว'));return;}
        resolve(result);
      }).withFailureHandler(reject)[name](token,...args);
    });
  }
  function status(message,error=false){
    const node=root?.querySelector('[data-external-status]');
    if(node){node.textContent=message;node.style.color=error?'var(--red)':'var(--teal2)';}
  }
  async function run(action){
    if(busy)return;
    busy=true;
    const controls=[...(root?.querySelectorAll('button')||[])].map(button=>[button,button.disabled]);
    controls.forEach(([button])=>button.disabled=true);
    try{await action();}
    catch(error){status(error.message||'ติดต่อระบบไม่ได้',true);}
    finally{busy=false;controls.forEach(([button,disabled])=>button.disabled=disabled);}
  }
  function mount(container){
    root=container;
    if(!root)return;
    if(!visible){root.replaceChildren();return;}
    render();
    run(loadHistory);
  }
  function open(values){
    visible=true;defaults=values||null;
    if(root){render();root.scrollIntoView({behavior:'smooth',block:'start'});run(loadHistory);}
  }
  function render(){
    const now=new Date();
    const val=defaults||{};
    const field=(key,value)=>root.querySelector('[name="'+key+'"]').value=value;
    root.innerHTML=`<section class="sett-sec" style="margin-bottom:16px">
      <div class="sett-ttl">🧭 ส่ง Elective ให้ผู้ประเมินภายนอก</div>
      <p style="font-size:12px;line-height:1.7;margin-bottom:12px">สร้างลิงก์เฉพาะแพทย์และช่วงฝึก แล้วคัดลอกส่งให้ผู้ประเมินโดยตรง ลิงก์ส่งผลได้ครั้งเดียวและมีวันหมดอายุ</p>
      <form data-external-invite-form>
        <div class="frow">
          <div class="fgrp"><label class="flbl" for="ext-invite-resident">แพทย์ผู้ถูกประเมิน *</label><select id="ext-invite-resident" name="residentId" class="finp" required><option value="">เลือกแพทย์</option>${getResidents().map(person=>`<option value="${escapeHtml(person.id)}">${escapeHtml([person.fn,person.ln].filter(Boolean).join(' '))} (${escapeHtml(person.id)})</option>`).join('')}</select></div>
          <div class="fgrp"><label class="flbl" for="ext-invite-name">ชื่อผู้ประเมินที่ต้องการเชิญ</label><input id="ext-invite-name" name="evaluatorName" class="finp" maxlength="200"></div>
        </div>
        <div class="frow">
          <div class="fgrp"><label class="flbl" for="ext-invite-unit">หน่วยฝึกอบรม *</label><select id="ext-invite-unit" name="trainingUnit" class="finp" required>${units.map(unit=>`<option>${escapeHtml(unit)}</option>`).join('')}</select></div>
          <div class="fgrp"><label class="flbl" for="ext-invite-institution">สถาบันฝึกอบรม *</label><input id="ext-invite-institution" name="institution" class="finp" maxlength="300" required></div>
        </div>
        <div class="frow">
          <div class="fgrp"><label class="flbl" for="ext-invite-month">เดือนสำหรับจัดกลุ่มผล *</label><select id="ext-invite-month" name="assessMonth" class="finp" required>${Array.from({length:12},(_,index)=>`<option value="${index+1}">${new Date(2026,index,1).toLocaleDateString('th-TH',{month:'long'})}</option>`).join('')}</select></div>
          <div class="fgrp"><label class="flbl" for="ext-invite-year">ปี พ.ศ. สำหรับจัดกลุ่มผล *</label><input id="ext-invite-year" name="assessBEYear" type="number" class="finp" min="2500" max="2700" required></div>
          <div class="fgrp"><label class="flbl" for="ext-invite-days">อายุลิงก์ (วัน)</label><input id="ext-invite-days" name="expiryDays" type="number" class="finp" min="1" max="30" value="14" required></div>
        </div>
        <div class="frow">
          <div class="fgrp"><label class="flbl" for="ext-invite-start">วันเริ่มฝึก *</label><input id="ext-invite-start" name="trainingStart" type="date" class="finp" min="1957-01-01" max="2157-12-31" required></div>
          <div class="fgrp"><label class="flbl" for="ext-invite-end">วันสิ้นสุดการฝึก *</label><input id="ext-invite-end" name="trainingEnd" type="date" class="finp" min="1957-01-01" max="2157-12-31" required></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"><span class="flbl" style="align-self:center">เลือกช่วงฝึกเร็ว:</span><button class="abtn" type="button" data-external-period="full">เต็มเดือน</button><button class="abtn" type="button" data-external-period="first">วันที่ 1–15</button><button class="abtn" type="button" data-external-period="second">วันที่ 16–สิ้นเดือน</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="abtn t" type="submit">สร้างลิงก์ประเมิน</button><button class="abtn" type="button" data-external-refresh>รีเฟรชสถานะ</button><button class="abtn" type="button" data-external-close>ปิด</button></div>
      </form>
      <div data-external-status role="status" style="font-size:12px;line-height:1.7;margin:10px 0">พร้อมสร้างลิงก์</div>
      <div data-external-link></div>
      <div data-external-history style="overflow-x:auto;margin-top:10px"></div>
    </section>`;
    field('residentId',val.residentId||'');field('evaluatorName',val.evaluatorName||'');field('institution',val.institution||'');
    field('trainingUnit',units.includes(val.trainingUnit)?val.trainingUnit:units[0]);
    field('assessMonth',val.assessMonth||String(now.getMonth()+1));field('assessBEYear',val.assessBEYear||String(now.getFullYear()+543));
    const start=root.querySelector('[name="trainingStart"]'),end=root.querySelector('[name="trainingEnd"]');
    const updateEndMinimum=()=>{end.min=start.value||'1957-01-01';};
    function choosePeriod(mode='full'){
      const month=Number(root.querySelector('[name="assessMonth"]').value),year=Number(root.querySelector('[name="assessBEYear"]').value)-543;
      if(!Number.isInteger(month)||month<1||month>12||!Number.isInteger(year)||year<1957||year>2157)return;
      const prefix=String(year)+'-'+String(month).padStart(2,'0')+'-';
      const last=new Date(Date.UTC(year,month,0)).getUTCDate();
      start.value=prefix+(mode==='second'?'16':'01');end.value=prefix+(mode==='first'?'15':String(last));updateEndMinimum();
    }
    choosePeriod();
    if(val.trainingStart&&val.trainingEnd){start.value=val.trainingStart;end.value=val.trainingEnd;updateEndMinimum();}
    root.querySelectorAll('[data-external-period]').forEach(button=>button.addEventListener('click',()=>choosePeriod(button.dataset.externalPeriod)));
    ['assessMonth','assessBEYear'].forEach(name=>root.querySelector('[name="'+name+'"]').addEventListener('change',()=>choosePeriod()));
    start.addEventListener('change',()=>{
      updateEndMinimum();
      if(/^\d{4}-\d{2}-\d{2}$/.test(start.value)){
        field('assessMonth',String(Number(start.value.slice(5,7))));field('assessBEYear',String(Number(start.value.slice(0,4))+543));
      }
    });
    defaults=null;
    root.querySelector('[data-external-invite-form]').addEventListener('submit',event=>{
      event.preventDefault();
      const form=event.currentTarget;
      if(!form.reportValidity())return;
      const input=Object.fromEntries(['residentId','evaluatorName','institution','trainingUnit','assessMonth','assessBEYear','expiryDays','trainingStart','trainingEnd'].map(name=>[name,form.elements.namedItem(name).value.trim()]));
      if(!input.trainingStart||!input.trainingEnd||input.trainingStart>input.trainingEnd){status('กรุณาตรวจสอบวันเริ่มและวันสิ้นสุดการฝึก',true);return;}
      run(async()=>{
        if(!await flushPendingSaves(true))throw new Error('กรุณาบันทึกข้อมูลที่ค้างอยู่ให้เสร็จก่อน');
        status('กำลังสร้างลิงก์...');
        const result=await rpc('createExternalElectiveInvite',input);
        const box=root.querySelector('[data-external-link]');box.replaceChildren();
        const label=document.createElement('label');label.className='flbl';label.textContent='คัดลอกลิงก์นี้เก็บไว้สำหรับส่งให้ผู้ประเมิน';
        const link=document.createElement('textarea');link.className='finp';link.readOnly=true;link.rows=3;link.value=result.url;link.setAttribute('aria-label','ลิงก์ประเมินภายนอก');
        const copy=document.createElement('button');copy.className='abtn t';copy.type='button';copy.textContent='คัดลอกลิงก์';
        copy.addEventListener('click',async()=>{
          link.focus();link.select();
          try{await navigator.clipboard.writeText(link.value);status('คัดลอกลิงก์แล้ว ส่งให้ผู้ประเมินได้เลย');}
          catch(error){status('เลือกลิงก์ไว้แล้ว กด Ctrl+C หรือคัดลอกข้อความ');}
        });
        box.append(label,link,copy);
        status('สร้างลิงก์แล้ว · ส่งภายใน '+date(result.invite.expiresAt));
        onUpdated();
        page=0;await loadHistory();
      });
    });
    root.querySelector('[data-external-refresh]').addEventListener('click',()=>run(async()=>{await loadHistory();onUpdated();status('โหลดสถานะล่าสุดแล้ว');}));
    root.querySelector('[data-external-close]').addEventListener('click',()=>{visible=false;root.replaceChildren();});
  }
  async function loadHistory(){
    const result=await rpc('listExternalElectiveInvites',page);
    const box=root.querySelector('[data-external-history]');
    if(!box)return;
    box.innerHTML=result.items.length?`<table class="tbl"><thead><tr><th>แพทย์</th><th>ช่วงฝึก / สถาบัน</th><th>ผู้ประเมินที่เชิญ</th><th>ส่งภายใน</th><th>สถานะ</th><th></th></tr></thead><tbody>${result.items.map(item=>`<tr><td>${escapeHtml(item.residentName)}</td><td>${escapeHtml(trainingPeriod(item))} · ${escapeHtml(item.institution)}</td><td>${escapeHtml(item.evaluatorName||'ระบุเมื่อกรอกแบบประเมิน')}</td><td>${escapeHtml(date(item.expiresAt))}</td><td>${escapeHtml(statuses[item.status]||item.status)}</td><td>${item.status==='pending'?`<button type="button" class="abtn" data-revoke-invite="${escapeHtml(item.id)}">ยกเลิกลิงก์</button>`:''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-st">ยังไม่มีลิงก์ประเมินภายนอก</div>';
    box.querySelectorAll('[data-revoke-invite]').forEach(button=>button.addEventListener('click',()=>run(async()=>{
      if(!confirm('ยกเลิกสิทธิ์ใช้ลิงก์ประเมินนี้หรือไม่?'))return;
      if(!await flushPendingSaves(true))throw new Error('กรุณาบันทึกข้อมูลที่ค้างอยู่ให้เสร็จก่อน');
      await rpc('revokeExternalElectiveInvite',button.dataset.revokeInvite);await loadHistory();onUpdated();status('ยกเลิกลิงก์แล้ว');
    })));
    if(result.total>25){
      const controls=document.createElement('div');controls.style.marginTop='8px';
      [['ก่อนหน้า',-1,page===0],['ถัดไป',1,(page+1)*25>=result.total]].forEach(([text,delta,disabled])=>{
        const button=document.createElement('button');button.className='abtn';button.type='button';button.textContent=text;button.disabled=disabled;
        button.addEventListener('click',()=>run(async()=>{page+=delta;await loadHistory();}));controls.append(button);
      });box.append(controls);
    }
  }
  return {mount,open};
}
