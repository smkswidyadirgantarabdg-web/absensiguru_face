const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";
const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const statusBox = document.getElementById("status");
const guruInfo = document.getElementById("guruInfo");
const guruId = document.getElementById("guruId");
let stream = null;
let modelsReady = false;
let selectedGuru = null;
let busy = false;

const $ = id => document.getElementById(id);
function status(title, detail=""){statusBox.innerHTML=`<div class="big">${title}</div><div class="small">${detail}</div>`;}
function jsonp(params){
  return new Promise((resolve,reject)=>{
    const cb="cb_"+Date.now()+"_"+Math.floor(Math.random()*10000);
    const s=document.createElement("script");
    const q=new URLSearchParams({...params,callback:cb});
    s.src=window.ABSENSI_GAS_URL+"?"+q.toString();
    const timer=setTimeout(()=>{cleanup();reject(new Error("Server timeout"));},15000);
    window[cb]=(data)=>{clearTimeout(timer);cleanup();resolve(data)};
    s.onerror=()=>{clearTimeout(timer);cleanup();reject(new Error("Gagal menghubungi server"))};
    function cleanup(){delete window[cb];s.remove()}
    document.body.appendChild(s);
  });
}
async function loadModels(){
  if(modelsReady)return;
  status("Memuat model AI…","Pertama kali membutuhkan internet beberapa saat.");
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
  ]);
  modelsReady=true;
}
async function startCamera(){
  await loadModels();
  if(stream)return;
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1280},height:{ideal:720}},audio:false});
  video.srcObject=stream;
  await video.play();
  canvas.width=video.videoWidth||1280; canvas.height=video.videoHeight||720;
  status("Kamera aktif","Posisikan satu wajah di tengah kamera.");
  detectLoop();
}
function stopCamera(){
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
  video.srcObject=null;
  status("Kamera dimatikan","Tekan Aktifkan Kamera untuk memulai.");
}
async function detectLoop(){
  if(!stream)return;
  const opts=new faceapi.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:.55});
  const d=await faceapi.detectSingleFace(video,opts).withFaceLandmarks().withFaceDescriptor();
  const ctx=canvas.getContext("2d");ctx.clearRect(0,0,canvas.width,canvas.height);
  if(d){
    const resized=faceapi.resizeResults(d,{width:canvas.width,height:canvas.height});
    faceapi.draw.drawDetections(canvas,resized);
    if(!busy) status("Wajah terdeteksi","Pastikan wajah lurus, cukup terang, dan hanya satu orang di kamera.");
  } else if(!busy) status("Mencari wajah…","Arahkan wajah ke kamera.");
  requestAnimationFrame(detectLoop);
}
async function captureDescriptor(){
  const opts=new faceapi.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:.50});
  // Detect ALL faces first so we never accidentally extract one face
  // while another person is also visible.
  const all=await faceapi.detectAllFaces(video,opts).withFaceLandmarks().withFaceDescriptors();
  if(all.length===0)throw new Error("Wajah belum terdeteksi. Posisikan wajah di tengah kamera.");
  if(all.length>1)throw new Error("Terdeteksi lebih dari satu wajah. Pastikan hanya satu wajah di kamera.");
  const d=all[0];
  if(!d.descriptor || d.descriptor.length!==128)throw new Error("Data wajah tidak berhasil dibuat. Coba lagi.");
  return Array.from(d.descriptor);
}
function livenessBasic(){
  // Lightweight liveness: require a small horizontal head movement.
  // The original 1.8 s / 3 px check was too strict on many phone cameras.
  return new Promise(resolve=>{
    const start=performance.now(), samples=[];
    const duration=3200, minSamples=4, minMove=2;
    const timer=setInterval(async()=>{
      try{
        const opts=new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.45});
        const all=await faceapi.detectAllFaces(video,opts).withFaceLandmarks();
        if(all.length===1){
          samples.push(all[0].landmarks.getNose().x);
          if(!busy)status("Uji wajah aktif…","Gerakkan kepala sedikit ke kiri lalu ke kanan.");
        } else if(all.length>1 && !busy){
          status("Lebih dari satu wajah","Pastikan hanya satu wajah di kamera.");
        }
      }catch(e){}
      if(performance.now()-start>=duration){
        clearInterval(timer);
        const moved=samples.length>=minSamples && (Math.max(...samples)-Math.min(...samples)>=minMove);
        resolve(moved);
      }
    },160);
  });
}
async function loadGuru(){
  const id=guruId.value.trim();
  if(!id)return alert("Masukkan ID Guru/NIP.");
  try{
    const r=await jsonp({action:"getGuru",guruId:id});
    if(!r.ok)throw new Error(r.message||"Guru tidak ditemukan.");
    selectedGuru=r.guru;
    guruInfo.innerHTML=`<div class="big">${escapeHtml(selectedGuru.nama)}</div>
      <div class="small">ID: ${escapeHtml(selectedGuru.id)}<br>Mapel/Jabatan: ${escapeHtml(selectedGuru.jabatan||"-")}<br>Status wajah: ${selectedGuru.hasFace?"TERDAFTAR":"BELUM TERDAFTAR"}</div>`;
  }catch(e){selectedGuru=null;guruInfo.innerHTML=`<div class="small">${escapeHtml(e.message)}</div>`}
}
async function enroll(){
  if(!selectedGuru)await loadGuru();
  if(!selectedGuru)return;
  busy=true;
  try{
    await startCamera();
    status("Pendaftaran wajah","Lihat kamera. Gerakkan kepala sedikit ke kiri lalu ke kanan.");
    const live=await livenessBasic();
    if(!live)throw new Error("Wajah belum berhasil diverifikasi sebagai wajah hidup. Pastikan pencahayaan cukup dan gerakkan kepala sedikit ke kiri-kanan.");
    status("Mengambil data wajah…","Jangan bergerak selama beberapa detik.");
    const desc=await captureDescriptor();
    status("Menyimpan wajah…","Mengirim descriptor ke server.");
    const r=await jsonp({action:"enrollFace",guruId:selectedGuru.id,descriptor:JSON.stringify(desc)});
    if(!r.ok)throw new Error(r.message||"Gagal menyimpan wajah.");
    selectedGuru.hasFace=true;
    status("✓ WAJAH BERHASIL DIDAFTARKAN",`${selectedGuru.nama} (${selectedGuru.id})`);
    await loadGuru();
  }catch(e){
    status("✕ PENDAFTARAN GAGAL",e.message);
  }finally{busy=false}
}
async function verify(){
  if(!selectedGuru)await loadGuru();
  if(!selectedGuru)return;
  busy=true;
  try{
    if(!selectedGuru.hasFace)throw new Error("Wajah guru belum didaftarkan. Daftarkan wajah terlebih dahulu.");
    await startCamera();
    status("Verifikasi wajah","Gerakkan kepala sedikit ke kiri lalu ke kanan.");
    const live=await livenessBasic();
    if(!live)throw new Error("Liveness gagal. Pastikan pencahayaan cukup dan gerakkan kepala sedikit.");
    status("Mencocokkan wajah…","Mohon tunggu.");
    const desc=await captureDescriptor();
    const r=await jsonp({action:"verifyFace",guruId:selectedGuru.id,descriptor:JSON.stringify(desc)});
    if(!r.ok){
      status("✕ WAJAH TIDAK DIKENALI",`${selectedGuru.nama} — jarak: ${Number(r.distance||0).toFixed(4)}`);
      return;
    }
    const a=await jsonp({action:"recordAttendance",guruId:selectedGuru.id,score:r.distance});
    if(!a.ok)throw new Error(a.message||"Wajah dikenali, tetapi absensi gagal disimpan.");
    status("✓ WAJAH DIKENALI — ABSEN BERHASIL",`${selectedGuru.nama} — ${a.jam} — ${a.status} — jarak ${Number(r.distance).toFixed(4)}`);
  }catch(e){status("✕ VERIFIKASI GAGAL",e.message)}
  finally{busy=false}
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
setInterval(()=>{ $("clock").textContent=new Date().toLocaleString("id-ID",{weekday:"long",day:"2-digit",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"});},1000);
$("startBtn").onclick=()=>startCamera().catch(e=>status("Kamera gagal",e.message));
$("stopBtn").onclick=stopCamera;
$("loadBtn").onclick=loadGuru;
$("enrollBtn").onclick=enroll;
$("verifyBtn").onclick=verify;
