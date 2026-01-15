/* ================= CONFIG ================= */
const deviceId = "smartplant-19";

const broker = "1ef28a790e1e4485b43597cba588c4f5.s1.eu.hivemq.cloud";

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

/* ================= DOM ================= */
const $ = id => document.getElementById(id);

const connDot   = $("connDot");
const connText  = $("connText");
const hum1El    = $("hum1"); // Dulu tempEl
const hum2El    = $("hum2"); // Dulu humEl
const modePill  = $("modePill");
const relayPill = $("relayPill");
const logBox    = $("log");
const logCount  = $("logCount");
const lastLog   = $("lastLogTime");

/* ================= MQTT ================= */
const client = mqtt.connect(broker, options);

client.on("connect", () => {
  setConnected();
  client.subscribe(TOPIC_TELE);
  log("MQTT connected");
});

client.on("reconnect", () => log("Reconnecting..."));
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

/* ================= MODE UI ================= */
function updateModeUI(mode) {
  // Update Teks Pill
  modePill.textContent = mode;

  // Reset semua tombol jadi tidak aktif
  $("btnManual").className = "btn mode-btn";
  $("btnTime").className = "btn mode-btn";
  $("btnSoil").className = "btn mode-btn";

  // Aktifkan tombol yang sesuai dengan mode dari alat
  if (mode === "MANUAL") $("btnManual").classList.add("active");
  if (mode === "TIME" || mode === "AUTO_TIME") $("btnTime").classList.add("active");
  if (mode === "SOIL" || mode === "AUTO_SOIL") $("btnSoil").classList.add("active");

  // Tombol Pompa hanya aktif di Manual
  const isManual = (mode === "MANUAL");
  $("btnOn").disabled  = !isManual;
  $("btnOff").disabled = !isManual;
}

/* ================= GRAFIK ================= */
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
        label: "Tanah 1", // Dulu 'Temperature'
        borderColor: "#2f7d5c", // Warna Hijau
        backgroundColor: "rgba(47, 125, 92, 0.1)",
        data: [],
        tension: 0.4,
        fill: true
      },
      {
        label: "Tanah 2", // Dulu 'Humidity'
        borderColor: "#5a8de1", // Warna Biru
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
    scales: {
      y: { beginAtZero: true }
    }
  }
});

/* ================= RECEIVE ================= */
client.on("message", (topic, payload) => {
  
  log(topic + " → " + payload);

  if (topic !== TOPIC_TELE) return;

  const d = JSON.parse(payload);

  // === SENSOR ===
  if(hum1El) hum1El.innerText = d.temp; 
  if(hum2El) hum2El.innerText = d.hum;

  // === MODE & RELAY ===
  updateModeUI(d.mode);

  relayPill.textContent = d.relay ? "ON" : "OFF";
  relayPill.className = "pill " + (d.relay ? "on" : "off");

  // === INFO ===
  $("deviceId").textContent = deviceId;
  $("ts").textContent = d.ts ?? "--";

  // === JADWAL (sinkron dari ESP32) ===
  if (d.schedule) {
    $("scheduleSummary").innerHTML = `
      <i class="fas fa-calendar-check"></i>
      <div>
        <strong>Jadwal Aktif:</strong>
        ON jam ${d.schedule.on1} dan ${d.schedule.on2}
        selama ${d.schedule.duration_min} menit.
      </div>
    `;
  }

  // === UPDATE GRAFIK ===
  const time = new Date().toLocaleTimeString();
  labels.push(time);
  tempData.push(d.temp); // Sensor 1
  humData.push(d.hum);

  if (labels.length > maxPoints) {
    labels.shift();
    tempData.shift();
    humData.shift();
  }

  chart.update();
});

/* ================= SEND ================= */
// 1. Tombol Mode
$("btnManual").onclick = () => sendMode("MANUAL");
$("btnTime").onclick   = () => sendMode("TIME");
$("btnSoil").onclick   = () => sendMode("SOIL");

// PERBAIKAN: Tambahkan ini agar tombol pompa berfungsi
$("btnOn").onclick  = () => sendRelay(1);
$("btnOff").onclick = () => sendRelay(0);

// 2. Tombol Limit (Batas Tanah)
$("btnSetLimit").onclick = () => {
  const val = parseInt($("limitInput").value);
  client.publish(TOPIC_LIMIT, JSON.stringify({ limit: val }));
  alert("Batas tanah dikirim: " + val + "%");
};

$("btnSetSchedule").onclick = () => {
  const [h1,m1] = $("on1Input").value.split(":");
  const [h2,m2] = $("on2Input").value.split(":");
  const dur = +$("durationInput").value;

  client.publish(TOPIC_SCHED, JSON.stringify({
    on1_hh: +h1, on1_mm: +m1,
    on2_hh: +h2, on2_mm: +m2,
    duration_min: dur
  }));

  $("scheduleSummary").innerHTML = `
    <i class="fas fa-calendar-check"></i>
    <div>
      <strong>Jadwal Aktif:</strong>
      ON jam ${h1}:${m1} dan ${h2}:${m2}
      selama ${dur} menit.
    </div>
  `;
};

function sendMode(mode){
  client.publish(TOPIC_MODE, JSON.stringify({ mode }));
}

function sendRelay(state){
  client.publish(TOPIC_RELAY, JSON.stringify({ state }));
}

/* ================= LOG ================= */
let logs = 0;
function log(msg){
  const t = new Date().toLocaleTimeString();
  logBox.innerHTML += `[${t}] ${msg}<br>`;
  logBox.scrollTop = logBox.scrollHeight;
  logCount.textContent = ++logs;
  lastLog.textContent = t;
}

/* ================= CLOCK ================= */
setInterval(() => {
  $("currentTime").textContent = new Date().toLocaleTimeString();
}, 1000);
