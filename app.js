/* ================= CONFIG ================= */
const deviceId = "smartplant-19";
const broker = "wss://1ef28a790e1e4485b43597cba588c4f5.s1.eu.hivemq.cloud:8884/mqtt";

const options = {
  clientId: "web_" + Math.random().toString(16).substr(2, 8),
  username: "smartplant",
  password: "kkn19desaTG",
  clean: true,
  keepalive: 60,
  reconnectPeriod: 2000
};

/* ================= TOPIC ================= */
const TOPIC_TELE  = `hydroponic/${deviceId}/telemetry`;
const TOPIC_MODE  = `hydroponic/${deviceId}/cmd/mode`;
const TOPIC_LIMIT = `hydroponic/${deviceId}/cmd/limit`;
const TOPIC_RELAY = `hydroponic/${deviceId}/cmd/relay`;
const TOPIC_SCHED = `hydroponic/${deviceId}/cmd/schedule`;

/* ================= DOM ELEMENTS ================= */
const $ = id => document.getElementById(id);

const connDot   = $("connDot");
const connText  = $("connText");
const hum1El    = $("hum1");
const hum2El    = $("hum2");
const modePill  = $("modePill");
const relayPill = $("relayPill");
const logBox    = $("log");
const logCount  = $("logCount");
const lastLog   = $("lastLogTime");

// Variabel Lokal untuk Menyimpan Batas (Limit)
let currentLimit = 30; // Default

/* ================= MQTT CONNECTION ================= */
const client = mqtt.connect(broker, options);

client.on("connect", () => {
  setConnected();
  client.subscribe(TOPIC_TELE);
  log("MQTT Terhubung. Menunggu data...");
});

client.on("reconnect", () => log("Mencoba koneksi ulang..."));
client.on("offline", () => setDisconnected());
client.on("error", err => log("Error: " + err.message));

function setConnected(){
  connDot.className = "dot on";
  connText.textContent = "Terhubung";
}

function setDisconnected(){
  connDot.className = "dot off";
  connText.textContent = "Terputus";
}

/* ================= UI UPDATER ================= */
function updateModeUI(mode) {
  modePill.textContent = mode;

  // Reset tombol
  $("btnManual").className = "btn mode-btn";
  $("btnTime").className = "btn mode-btn";
  $("btnSoil").className = "btn mode-btn";

  // Highlight tombol aktif
  if (mode === "MANUAL") $("btnManual").classList.add("active");
  if (mode === "TIME" || mode === "AUTO_TIME") $("btnTime").classList.add("active");
  if (mode === "SOIL" || mode === "AUTO_SOIL") $("btnSoil").classList.add("active");

  // Kontrol akses tombol pompa (Hanya aktif di Manual)
  const isManual = (mode === "MANUAL");
  $("btnOn").disabled  = !isManual;
  $("btnOff").disabled = !isManual;
}

/* ================= CHART CONFIG ================= */
const ctx = document.getElementById("chart").getContext("2d");
const maxPoints = 60;
let labels = [];
let tempData = [];
let humData  = [];

const chart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [
      {
        label: "Tanah 1",
        borderColor: "#2f7d5c", // Hijau
        backgroundColor: "rgba(47, 125, 92, 0.1)",
        data: [],
        tension: 0.4,
        fill: true
      },
      {
        label: "Tanah 2",
        borderColor: "#5a8de1", // Biru
        backgroundColor: "rgba(90, 141, 225, 0.1)",
        data: [],
        tension: 0.4,
        fill: true
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: { y: { beginAtZero: true, max: 100 } }
  }
});

/* ================= MESSAGE HANDLING ================= */
client.on("message", (topic, payload) => {
  if (topic !== TOPIC_TELE) return;

  try {
    const d = JSON.parse(payload);
    
    // 1. UPDATE ANGKA SENSOR & WARNA MERAH JIKA KERING
    if(hum1El) {
      hum1El.innerText = d.temp;
      // Jika nilai < limit, warnanya Merah. Jika aman, warna Hitam.
      hum1El.style.color = (d.temp < currentLimit) ? "var(--danger)" : "var(--text)";
      hum1El.style.fontWeight = (d.temp < currentLimit) ? "bold" : "normal";
    }
    
    if(hum2El) {
      hum2El.innerText = d.hum;
      hum2El.style.color = (d.hum < currentLimit) ? "var(--danger)" : "var(--text)";
      hum2El.style.fontWeight = (d.hum < currentLimit) ? "bold" : "normal";
    }

    // 2. UPDATE LIMIT (Jika ada feedback dari alat)
    if(d.limit) {
      currentLimit = d.limit;
      // Opsional: update input value jika mau sinkron dua arah
      // $("limitInput").value = d.limit; 
    }

    // 3. UPDATE STATUS LAIN
    updateModeUI(d.mode);
    relayPill.textContent = d.relay ? "ON" : "OFF";
    relayPill.className = "pill " + (d.relay ? "on" : "off");

    $("deviceId").textContent = deviceId;
    $("ts").textContent = d.ts ?? "--";

    // 4. UPDATE INFO JADWAL
    if (d.schedule) {
      $("scheduleSummary").innerHTML = `
        <i class="fas fa-calendar-check"></i> 
        Jadwal: <b>${d.schedule.on1}</b> & <b>${d.schedule.on2}</b> (${d.schedule.duration_min} mnt)
      `;
    }

    // 5. UPDATE GRAFIK
    const time = new Date().toLocaleTimeString();
    labels.push(time);
    tempData.push(d.temp);
    humData.push(d.hum);

    if (labels.length > maxPoints) {
      labels.shift(); tempData.shift(); humData.shift();
    }
    chart.data.labels = labels;
    chart.data.datasets[0].data = tempData;
    chart.data.datasets[1].data = humData;
    chart.update();

    log(`Data: T1=${d.temp}% T2=${d.hum}% P=${d.relay}`);

  } catch (e) {
    console.error("JSON Error:", e);
  }
});

/* ================= SEND COMMANDS ================= */
// Mode
$("btnManual").onclick = () => sendMode("MANUAL");
$("btnTime").onclick   = () => sendMode("TIME");
$("btnSoil").onclick   = () => sendMode("SOIL");

// Relay (Pompa)
$("btnOn").onclick  = () => sendRelay(1);
$("btnOff").onclick = () => sendRelay(0);

// Set Limit Tanah
$("btnSetLimit").onclick = () => {
  const val = parseInt($("limitInput").value);
  currentLimit = val; // Update lokal segera
  client.publish(TOPIC_LIMIT, JSON.stringify({ limit: val }));
  alert("Batas tanah dikirim: " + val + "%");
};

// Set Jadwal
$("btnSetSchedule").onclick = () => {
  const [h1,m1] = $("on1Input").value.split(":");
  const [h2,m2] = $("on2Input").value.split(":");
  const dur = +$("durationInput").value;

  client.publish(TOPIC_SCHED, JSON.stringify({
    on1_hh: +h1, on1_mm: +m1,
    on2_hh: +h2, on2_mm: +m2,
    duration_min: dur
  }));
  alert("Jadwal dikirim ke alat!");
};

// Helper Functions
function sendMode(mode){
  client.publish(TOPIC_MODE, JSON.stringify({ mode }));
}
function sendRelay(state){
  client.publish(TOPIC_RELAY, JSON.stringify({ state }));
}

/* ================= UTILS ================= */
let logs = 0;
function log(msg){
  const t = new Date().toLocaleTimeString();
  logBox.innerHTML += `<div style="border-bottom:1px solid #333; padding:2px;">[${t}] ${msg}</div>`;
  logBox.scrollTop = logBox.scrollHeight;
  logCount.textContent = ++logs;
  lastLog.textContent = t;
}

$("btnClearLog").onclick = () => {
  logBox.innerHTML = "";
  logs = 0;
  logCount.textContent = 0;
};

// Jam Digital Pojok Kanan
setInterval(() => {
  $("currentTime").textContent = new Date().toLocaleTimeString();
}, 1000);
