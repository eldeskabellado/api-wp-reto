import express, { Request, Response, NextFunction } from 'express';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  ConnectionState,
} from '@whiskeysockets/baileys';
import * as dotenv from 'dotenv';
import * as qrcode from 'qrcode';

// Cargar variables de entorno desde .env
dotenv.config();

const app = express();
app.use(express.json());

// Middleware de autenticación con Bearer Token
const apiKey = process.env.WHATSAPP_API_KEY;
if (!apiKey) throw new Error('WHATSAPP_API_KEY no está definida en .env');

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
    return res.status(401).json({ error: 'Autenticación fallida: Token inválido o ausente' });
  }
  next();
}

app.use('/api', authMiddleware);

// Variable para almacenar el QR y el socket
let currentQr: string | null = null;
let sock: ReturnType<typeof makeWASocket> | null = null;

// Función para inicializar o reconectar WhatsApp
async function connectToWhatsApp() {
  console.log('Iniciando conexión con WhatsApp...');
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    console.log(`Usando versión de Baileys: ${version.join('.')}`);

    sock = makeWASocket({
      version,
      auth: state,
      defaultQueryTimeoutMs: 60000,
    });

    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;
      console.log('Estado de conexión actualizado:', { connection, qr: qr ? 'QR generado' : 'Sin QR', lastDisconnect });

      if (qr) {
        currentQr = qr;
        console.log('QR generado:', qr);
        console.log('Visita http://localhost:3000/qr para verlo.');
      }
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log('Conexión cerrada. Código de estado:', statusCode, 'Reconectando:', shouldReconnect);
        currentQr = null;
        sock = null;
        if (shouldReconnect) {
          connectToWhatsApp();
        } else {
          console.log('Sesión cerrada manualmente. Elimina auth_info y reinicia para generar un nuevo QR.');
        }
      } else if (connection === 'open') {
        console.log('Conexión establecida con WhatsApp');
        currentQr = null;
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error('Error al iniciar la conexión con WhatsApp:', error);
  }
}

// Forzar la conexión al iniciar
connectToWhatsApp();

// Obtener o esperar el socket activo
async function getSocket(): Promise<ReturnType<typeof makeWASocket>> {
  if (!sock) {
    console.log('Socket no disponible, intentando reconectar...');
    await connectToWhatsApp();
    if (!sock) throw new Error('No se pudo establecer la conexión con WhatsApp');
  }
  return sock;
}

// Endpoint público para mostrar el QR
app.get('/qr', async (req: Request, res: Response) => {
  if (currentQr) {
    try {
      const qrImageUrl = await qrcode.toDataURL(currentQr);
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
    } catch (error) {
      res.status(500).send('Error al generar el QR');
    }
  } else {
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
});

// Endpoint para enviar mensaje de texto
app.post('/api/send-text', async (req: Request, res: Response) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: 'Faltan parámetros: "to" y "message" son requeridos' });
  }

  try {
    const sock = await getSocket();
    const formattedNumber = `${to}@s.whatsapp.net`;
    await sock.sendMessage(formattedNumber, { text: message });
    res.json({ success: true, message: 'Mensaje enviado correctamente' });
  } catch (error: unknown) {
    console.error('Error al enviar mensaje de texto:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ success: false, message: 'Error al enviar mensaje', error: errorMessage });
  }
});

// Endpoint para enviar mensaje con imagen (actualizado)
app.post('/api/send-image', async (req: Request, res: Response) => {
  const { to, imageUrl, caption, message } = req.body;
  if (!to || !imageUrl) {
    return res.status(400).json({ error: 'Faltan parámetros: "to" y "imageUrl" son requeridos' });
  }

  try {
    const sock = await getSocket();
    const formattedNumber = `${to}@s.whatsapp.net`;

    // Combinar caption y message si ambos están presentes
    const finalCaption = caption && message ? `${caption}\n${message}` : caption || message || '';

    await sock.sendMessage(formattedNumber, {
      image: { url: imageUrl },
      caption: finalCaption,
    });
    res.json({ success: true, message: 'Imagen enviada correctamente' });
  } catch (error: unknown) {
    console.error('Error al enviar imagen:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ success: false, message: 'Error al enviar imagen', error: errorMessage });
  }
});

// Endpoint para enviar mensaje con video
app.post('/api/send-video', async (req: Request, res: Response) => {
  const { to, videoUrl, caption } = req.body;
  if (!to || !videoUrl) {
    return res.status(400).json({ error: 'Faltan parámetros: "to" y "videoUrl" son requeridos' });
  }

  try {
    const sock = await getSocket();
    const formattedNumber = `${to}@s.whatsapp.net`;
    await sock.sendMessage(formattedNumber, { video: { url: videoUrl }, caption: caption || '' });
    res.json({ success: true, message: 'Video enviado correctamente' });
  } catch (error: unknown) {
    console.error('Error al enviar video:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ success: false, message: 'Error al enviar video', error: errorMessage });
  }
});

// Endpoint para enviar mensaje con ubicación
app.post('/api/send-location', async (req: Request, res: Response) => {
  const { to, latitude, longitude, name, address } = req.body;
  if (!to || !latitude || !longitude) {
    return res.status(400).json({ error: 'Faltan parámetros: "to", "latitude" y "longitude" son requeridos' });
  }

  try {
    const sock = await getSocket();
    const formattedNumber = `${to}@s.whatsapp.net`;
    await sock.sendMessage(formattedNumber, {
      location: {
        degreesLatitude: parseFloat(latitude),
        degreesLongitude: parseFloat(longitude),
        name: name || '',
        address: address || '',
      },
    });
    res.json({ success: true, message: 'Ubicación enviada correctamente' });
  } catch (error: unknown) {
    console.error('Error al enviar ubicación:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ success: false, message: 'Error al enviar ubicación', error: errorMessage });
  }
});

// Iniciar el servidor
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});