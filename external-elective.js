
  (function(){
    'use strict';
    let credential=null,model=null,sending=false,submitted=false;
    const form=document.getElementById('external-form');
    const button=document.getElementById('external-submit');
    const status=document.getElementById('external-status');
    const text=value=>String(value??'');
    function message(value,error=false){status.textContent=value;status.style.color=error?'var(--red)':'var(--teal2)';}
    function request(name,...args){
      return new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[name](...args));
    }
    function completed(result){
      submitted=true;
      form.style.display='none';
      message('ได้รับผลประเมินแล้ว · เลขที่ '+result.recordId+' · '+new Date(result.submittedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}));
    }
    function render(data){
      model=data;
      if(data.status==='submitted'){completed(data);return;}
      const portrait=document.getElementById('external-resident-portrait');
      const photo=document.getElementById('external-resident-photo');
      const emptyPhoto=document.getElementById('external-resident-photo-empty');
      portrait.hidden=false;
      photo.alt='รูปโปรไฟล์ '+text(data.residentName);
      photo.addEventListener('load',()=>{photo.hidden=false;emptyPhoto.hidden=true;});
      photo.addEventListener('error',()=>{photo.hidden=true;emptyPhoto.hidden=false;emptyPhoto.textContent='ไม่สามารถโหลดรูปโปรไฟล์ได้';});
      if(data.residentPhoto)photo.src=data.residentPhoto;
      const context=document.getElementById('external-context');
      const month=Number(data.assessMonth), year=Number(data.assessBEYear);
      const trainingDate=value=>new Date(value+'T00:00:00Z').toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Bangkok'});
      const period=data.trainingStart&&data.trainingEnd
        ? trainingDate(data.trainingStart)+' – '+trainingDate(data.trainingEnd)
        : new Date(year-543,month-1,1).toLocaleDateString('th-TH',{month:'long',year:'numeric'});
      [['แพทย์ผู้ถูกประเมิน',data.residentName],['ช่วงฝึก',period],['หน่วยฝึกอบรม',data.trainingUnit],['สถาบันฝึกอบรม',data.institution],['ส่งภายใน',new Date(data.expiresAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})]].forEach(([label,value])=>{
        const line=document.createElement('div');
        const title=document.createElement('strong');title.textContent=label+' ';line.append(title,document.createTextNode(text(value)));context.append(line);
      });
      context.style.display='block';
      document.getElementById('external-name').value=data.evaluatorName||'';
      document.getElementById('external-institution').value=data.institution||'';
      const tbody=document.getElementById('external-domains');
      data.template.sections.forEach(section=>{
        const heading=document.createElement('tr'),cell=document.createElement('th');cell.colSpan=6;cell.textContent=section.label;heading.append(cell);tbody.append(heading);
        section.items.forEach(item=>{
          const row=document.createElement('tr'),label=document.createElement('td');label.textContent=item.label;row.append(label);
          for(let score=1;score<=5;score++){
            const td=document.createElement('td'),choice=document.createElement('label'),input=document.createElement('input');
            td.className='external-score';input.type='radio';input.name='score_'+item.id;input.value=String(score);input.required=true;
            input.setAttribute('aria-label',item.label+' คะแนน '+score);choice.append(input);td.append(choice);row.append(td);
          }
          tbody.append(row);
        });
      });
      form.style.display='block';
      message('กรุณาตรวจชื่อแพทย์และช่วงฝึกก่อนให้คะแนน');
    }
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(sending||submitted||!credential||!model||!form.reportValidity())return;
      const scores={};
      for(const section of model.template.sections)for(const item of section.items){
        const checked=form.querySelector('input[name="score_'+item.id+'"]:checked');
        if(!checked){message('กรุณาให้คะแนนครบทุกหัวข้อ',true);return;}
        scores[item.id]=Number(checked.value);
      }
      sending=true;button.disabled=true;button.textContent='กำลังบันทึก...';
      try{
        const result=await request('submitExternalElectiveAssessment',credential.id,credential.secret,{
          evaluatorName:document.getElementById('external-name').value,evaluatorInstitution:document.getElementById('external-institution').value,
          comment:document.getElementById('external-comment').value,confirmed:document.getElementById('external-confirm').checked,scores
        });
        if(result?.ok!==true)throw new Error('ยังยืนยันการบันทึกไม่ได้ กรุณาลองอีกครั้ง');
        completed(result);
      }catch(error){message(error.message||'บันทึกไม่สำเร็จ กรุณาลองส่งอีกครั้ง',true);}
      finally{sending=false;button.disabled=false;button.textContent='ส่งผลประเมิน';}
    });
    window.addEventListener('beforeunload',event=>{
      if(submitted||!sending)return;
      event.preventDefault();event.returnValue='';
    });
    if(typeof google==='undefined'){message('กรุณาเปิดแบบประเมินผ่านลิงก์ที่ได้รับ',true);return;}
    google.script.url.getLocation(async location=>{
      const match=String(location.hash||'').match(/^([a-f0-9-]{36})\.([a-f0-9]{64})$/i);
      if(!match){message('ลิงก์ประเมินไม่ครบ กรุณาเปิดลิงก์ที่ผู้ประสานงานส่งให้อีกครั้ง',true);return;}
      credential={id:match[1],secret:match[2]};
      try{render(await request('getExternalElectiveForm',credential.id,credential.secret));}
      catch(error){message(error.message||'เปิดแบบประเมินไม่ได้',true);}
    });
  })();
  