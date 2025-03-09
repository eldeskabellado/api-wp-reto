"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const dotenv = __importStar(require("dotenv"));
const qrcode = __importStar(require("qrcode"));
// Cargar variables de entorno desde .env
dotenv.config();
const app = (0, express_1.default)();
app.use(express_1.default.json());
// Middleware de autenticación con Bearer Token
const apiKey = process.env.WHATSAPP_API_KEY;
if (!apiKey)
    throw new Error('WHATSAPP_API_KEY no está definida en .env');
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
        return res.status(401).json({ error: 'Autenticación fallida: Token inválido o ausente' });
    }
    next();
}
app.use('/api', authMiddleware);
// Variable para almacenar el QR y el socket
let currentQr = null;
let sock = null;
// Función para inicializar o reconectar WhatsApp
function connectToWhatsApp() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Iniciando conexión con WhatsApp...');
        try {
            const { state, saveCreds } = yield (0, baileys_1.useMultiFileAuthState)('auth_info');
            const { version } = yield (0, baileys_1.fetchLatestBaileysVersion)();
            console.log(`Usando versión de Baileys: ${version.join('.')}`);
            sock = (0, baileys_1.default)({
                version,
                auth: state,
                defaultQueryTimeoutMs: 60000,
            });
            sock.ev.on('connection.update', (update) => {
                var _a, _b;
                const { connection, lastDisconnect, qr } = update;
                console.log('Estado de conexión actualizado:', { connection, qr: qr ? 'QR generado' : 'Sin QR', lastDisconnect });
                if (qr) {
                    currentQr = qr;
                    console.log('QR generado:', qr);
                    console.log('Visita http://localhost:3000/qr para verlo.');
                }
                if (connection === 'close') {
                    const statusCode = (_b = (_a = lastDisconnect === null || lastDisconnect === void 0 ? void 0 : lastDisconnect.error) === null || _a === void 0 ? void 0 : _a.output) === null || _b === void 0 ? void 0 : _b.statusCode;
                    const shouldReconnect = statusCode !== baileys_1.DisconnectReason.loggedOut;
                    console.log('Conexión cerrada. Código de estado:', statusCode, 'Reconectando:', shouldReconnect);
                    currentQr = null;
                    sock = null;
                    if (shouldReconnect) {
                        connectToWhatsApp();
                    }
                    else {
                        console.log('Sesión cerrada manualmente. Elimina auth_info y reinicia para generar un nuevo QR.');
                    }
                }
                else if (connection === 'open') {
                    console.log('Conexión establecida con WhatsApp');
                    currentQr = null;
                }
            });
            sock.ev.on('creds.update', saveCreds);
        }
        catch (error) {
            console.error('Error al iniciar la conexión con WhatsApp:', error);
        }
    });
}
// Forzar la conexión al iniciar
connectToWhatsApp();
// Obtener o esperar el socket activo
function getSocket() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!sock) {
            console.log('Socket no disponible, intentando reconectar...');
            yield connectToWhatsApp();
            if (!sock)
                throw new Error('No se pudo establecer la conexión con WhatsApp');
        }
        return sock;
    });
}
// Endpoint público para mostrar el QR
app.get('/qr', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    if (currentQr) {
        try {
            const qrImageUrl = yield qrcode.toDataURL(currentQr);
            const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>WhatsApp QR</title>
        </head>
        <body>
          <h1>Escanea este QR con WhatsApp</h1>
          <img src="${qrImageUrl}" alt="WhatsApp QR Code">
          <p>Escanea el código con tu teléfono para vincular WhatsApp.</p>
        </body>
        </html>
      `;
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        }
        catch (error) {
            res.status(500).send('Error al generar el QR');
        }
    }
    else {
        res.status(404).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>No QR</title>
      </head>
      <body>
        <h1>No hay QR disponible</h1>
        <p>Ya estás conectado o espera a que se genere un nuevo QR. Revisa la consola para más detalles.</p>
      </body>
      </html>
    `);
    }
}));
// Endpoint para enviar mensaje de texto
app.post('/api/send-text', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { to, message } = req.body;
    if (!to || !message) {
        return res.status(400).json({ error: 'Faltan parámetros: "to" y "message" son requeridos' });
    }
    try {
        const sock = yield getSocket();
        const formattedNumber = `${to}@s.whatsapp.net`;
        yield sock.sendMessage(formattedNumber, { text: message });
        res.json({ success: true, message: 'Mensaje enviado correctamente' });
    }
    catch (error) {
        console.error('Error al enviar mensaje de texto:', error);
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
        res.status(500).json({ success: false, message: 'Error al enviar mensaje', error: errorMessage });
    }
}));
// Endpoint para enviar mensaje con imagen (actualizado)
app.post('/api/send-image', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { to, imageUrl, caption, message } = req.body;
    if (!to || !imageUrl) {
        return res.status(400).json({ error: 'Faltan parámetros: "to" y "imageUrl" son requeridos' });
    }
    try {
        const sock = yield getSocket();
        const formattedNumber = `${to}@s.whatsapp.net`;
        // Combinar caption y message si ambos están presentes
        const finalCaption = caption && message ? `${caption}\n${message}` : caption || message || '';
        yield sock.sendMessage(formattedNumber, {
            image: { url: imageUrl },
            caption: finalCaption,
        });
        res.json({ success: true, message: 'Imagen enviada correctamente' });
    }
    catch (error) {
        console.error('Error al enviar imagen:', error);
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
        res.status(500).json({ success: false, message: 'Error al enviar imagen', error: errorMessage });
    }
}));
// Endpoint para enviar mensaje con video
app.post('/api/send-video', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { to, videoUrl, caption } = req.body;
    if (!to || !videoUrl) {
        return res.status(400).json({ error: 'Faltan parámetros: "to" y "videoUrl" son requeridos' });
    }
    try {
        const sock = yield getSocket();
        const formattedNumber = `${to}@s.whatsapp.net`;
        yield sock.sendMessage(formattedNumber, { video: { url: videoUrl }, caption: caption || '' });
        res.json({ success: true, message: 'Video enviado correctamente' });
    }
    catch (error) {
        console.error('Error al enviar video:', error);
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
        res.status(500).json({ success: false, message: 'Error al enviar video', error: errorMessage });
    }
}));
// Endpoint para enviar mensaje con ubicación
app.post('/api/send-location', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { to, latitude, longitude, name, address } = req.body;
    if (!to || !latitude || !longitude) {
        return res.status(400).json({ error: 'Faltan parámetros: "to", "latitude" y "longitude" son requeridos' });
    }
    try {
        const sock = yield getSocket();
        const formattedNumber = `${to}@s.whatsapp.net`;
        yield sock.sendMessage(formattedNumber, {
            location: {
                degreesLatitude: parseFloat(latitude),
                degreesLongitude: parseFloat(longitude),
                name: name || '',
                address: address || '',
            },
        });
        res.json({ success: true, message: 'Ubicación enviada correctamente' });
    }
    catch (error) {
        console.error('Error al enviar ubicación:', error);
        const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
        res.status(500).json({ success: false, message: 'Error al enviar ubicación', error: errorMessage });
    }
}));
// Iniciar el servidor
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});
