// server.js - Edge Computing Backend (Render + Mock Sensor Ready)
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Allow Flutter app from anywhere (web + mobile)
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// In-memory storage
let latestData = { temperature: 24.0, humidity: 60, timestamp: new Date().toISOString() };
let dataHistory = [];
let alertActive = false;

// =============== CONFIG FROM ENV (Perfect for Render) ===============
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'iot/sensor/dht22';
const ALERT_THRESHOLD = Number(process.env.ALERT_THRESHOLD) || 30;

// =============== MQTT Connection ===============
const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: 'edge-backend-' + Math.random().toString(16).slice(2, 8),
  reconnectPeriod: 5000,
});

mqttClient.on('connect', () => {
  console.log('Edge Backend connected to MQTT broker');
  mqttClient.subscribe(MQTT_TOPIC, (err) => {
    if (!err) console.log(`Subscribed to topic: ${MQTT_TOPIC}`);
    else console.error('Subscribe error:', err);
  });
});

mqttClient.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());

    console.log('Sensor Data Received →', {
      temp: data.temperature,
      hum: data.humidity,
      device: data.device || 'unknown',
      time: new Date().toLocaleTimeString()
    });

    latestData = {
      temperature: Number(data.temperature),
      humidity: Number(data.humidity),
      timestamp: new Date().toISOString(),
      device: data.device || 'mock-esp32'
    };

    dataHistory.push({ ...latestData });
    if (dataHistory.length > 200) dataHistory.shift();

    // EDGE ALERT LOGIC (Instant!
    if (latestData.temperature > ALERT_THRESHOLD && !alertActive) {
      alertActive = true;
      console.log('ALERT TRIGGERED ON EDGE!');
      io.emit('alert', {
        type: 'danger',
        message: `Critical Temperature: ${latestData.temperature}°C!`,
        timestamp: latestData.timestamp
      });
    } else if (latestData.temperature <= ALERT_THRESHOLD - 2) {
      alertActive = false;
    }

    // Push to all Flutter clients instantly
    io.emit('sensor-update', latestData);

  } catch (err) {
    console.error('Invalid JSON from sensor:', err.message);
  }
});

// =============== Socket.io ===============
io.on('connection', (socket) => {
  console.log('Flutter client connected:', socket.id);
  socket.emit('sensor-update', latestData);
  if (alertActive) socket.emit('alert', { message: 'Active high temperature!' });

  socket.on('disconnect', () => console.log('Client disconnected'));
});

// =============== REST APIs ===============
app.get('/', (req, res) => {
  res.send(`
    <h1>Edge Computing IoT Backend Running</h1>
    <p>Mock sensor data flowing → <b>${MQTT_TOPIC}</b></p>
    <p>Current: ${latestData.temperature}°C | ${latestData.humidity}%</p>
    <p>Alert Active: ${alertActive ? 'YES' : 'No'}</p>
  `);
});

app.get('/api/latest', (req, res) => res.json(latestData));
app.get('/api/history', (req, res) => res.json(dataHistory.slice(-50)));
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// =============== Start Server ===============
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Edge Backend LIVE at https://your-app.onrender.com`);
  console.log(`Waiting for mock sensor on topic: ${MQTT_TOPIC}`);
});