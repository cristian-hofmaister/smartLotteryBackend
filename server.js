require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
const { Server } = require('socket.io');
const http = require('http');

// Configuración
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const TRONGRID_API = process.env.TRONGRID_API;

const cors = require('cors');
app.use(cors());

// Middlewares
app.use(bodyParser.json());

// Conexión a la base de datos
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Conexión a MongoDB exitosa'))
    .catch(err => console.error('Error conectando a MongoDB:', err));

// Esquema y Modelo de Participantes
const participantSchema = new mongoose.Schema({
    otp: String,
    txid: String,
    address: String,
    amount: Number,
    validated: { type: Boolean, default: false }
});

const Participant = mongoose.model('Participant', participantSchema);

// Generar OTP
app.post('/generate-otp', async (req, res) => {
    const otp = crypto.randomBytes(3).toString('hex').toUpperCase();
    res.json({ otp, amount: (7 + Math.random() / 100).toFixed(3) });
});

// Validar Participación
app.post('/validate-participation', async (req, res) => {
    const { otp, txid, address } = req.body;

    try {
        // Validar transacción con TronGrid
        const txData = await axios.get(`${TRONGRID_API}/v1/transaction/${txid}`);
        if (!txData.data.success) throw new Error('TXID no válido');

        const transaction = txData.data.data[0];
        const amount = transaction.raw_data.contract[0].parameter.value.amount / 1e6; // Convertir a USDT
        const senderAddress = transaction.raw_data.contract[0].parameter.value.owner_address;

        if (amount.toFixed(3) !== req.body.amount.toFixed(3) || senderAddress !== address) {
            throw new Error('Monto o dirección no coinciden');
        }

        // Registrar participación
        const participant = new Participant({ otp, txid, address, amount });
        await participant.save();
        res.json({ message: 'Participación validada y registrada' });

        // Actualizar a los clientes en tiempo real
        io.emit('new-participation', participant);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Ejecutar Sorteo
app.post('/run-draw', async (req, res) => {
    const participants = await Participant.find({ validated: true });
    if (participants.length < 150) return res.status(400).json({ error: 'No hay suficientes participantes' });

    const hashInput = participants.map(p => p.txid).join('');
    const hash = crypto.createHash('sha256').update(hashInput).digest('hex');
    const winnerIndex = parseInt(hash, 16) % participants.length;

    const winner = participants[winnerIndex];
    res.json({ winner });
});

server.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));

