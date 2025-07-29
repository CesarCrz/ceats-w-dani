const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const fs = require('fs');
const socketIo = require('socket.io');
const { error } = require('console');
const app = express();
const server = http.createServer(app)
const io = socketIo(server)
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const PORT = process.env.PORT || 3000;

// Rutas relativas al backend/src
const PEDIDOS_FILE = path.join(__dirname, 'pedidos.json');

// Carpeta frontend raíz y src
const FRONTEND_ROOT = path.join(__dirname, '..', '..', 'frontend');
const FRONTEND_SRC = path.join(FRONTEND_ROOT, 'src');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'soru-secret-key',
  resave: false,
  saveUninitialized: false
}));

// Servir archivos estáticos desde frontend/src
app.use('/CSS', express.static(path.join(FRONTEND_SRC, 'CSS')));
app.use('/JS', express.static(path.join(FRONTEND_SRC, 'JS')));
app.use('/Audio', express.static(path.join(FRONTEND_SRC, 'Audio')));
app.use('/Img', express.static(path.join(FRONTEND_SRC, 'Img')));

// Para servir el index.html directamente
app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_ROOT, 'index.html'));
});
app.get('/main', (req, res) => {
  res.sendFile(path.join(FRONTEND_SRC, 'pages', 'main.html'));
});
app.get('/ticket', (req, res) => {
  res.sendFile(path.join(FRONTEND_SRC, 'pages', 'ticket.html'));
});
app.get('/main/pedidos/:sucursal', (req, res) => {
  res.sendFile(path.join(FRONTEND_SRC, 'pages', 'main.html'));
});

function cargarPedidos() {
  if (!fs.existsSync(PEDIDOS_FILE)) return []
  const raw = fs.readFileSync(PEDIDOS_FILE, 'utf-8');
  return JSON.parse(raw);
}

function guardarPedidos(pedidos) {
  fs.writeFileSync(PEDIDOS_FILE, JSON.stringify(pedidos, null, 2), 'utf-8');
}

app.post('/api/pedidos/:codigo/estado', (req, res) => {
  const { codigo } = req.params;
  const { estado} = req.body;
  
  if (!estado) {
    return res.status(400).json({error: 'Falto el campo de estado'});
  }

  let pedidos = cargarPedidos();
  const idx = pedidos.findIndex(p => p.codigo === codigo || p.orderId === codigo);

  if (idx === -1) {
    return res.status(404).json({error: 'Pedido no encontrado'});
  }

  pedidos[idx].estado = estado;
  guardarPedidos(pedidos);

  io.emit('update_order', pedidos[idx]);

  res.json({ success: true, pedido: pedidos[idx] });
});

// Endpoint para que Google Apps Script mande nuevos pedidos
app.post('/api/pedidos/:sucursal', (req, res) => {
  const { sucursal } = req.params;
  const pedido = req.body;

  pedido.codigo = pedido.codigo || pedido.orderId;

  // Normaliza el pedido para que siempre tenga un array en pedido.pedido
  if (typeof pedido.productDetails === 'string') {
    try {
      pedido.pedido = JSON.parse(pedido.productDetails);
    } catch (e) {
      pedido.pedido = [];
    }
  } else if (Array.isArray(pedido.productDetails)) {
    pedido.pedido = pedido.productDetails;
  } else if (typeof pedido.pedido === 'string') {
    try {
      pedido.pedido = JSON.parse(pedido.pedido);
    } catch (e) {
      pedido.pedido = [];
    }
  } else if (Array.isArray(pedido.pedido)) {
    // Ya está bien
  } else {
    pedido.pedido = [];
  }

  console.log(`Pedido nuevo para ${sucursal}:`, pedido);
  let pedidos = cargarPedidos();

  const yaExiste = pedidos.some(p => p.codigo === pedido.codigo);
  if (!yaExiste) {
    pedidos.push(pedido);
    guardarPedidos(pedidos);
  }
  
  io.emit('new_order', pedido);

  res.sendStatus(201);
});

app.get('/api/pedidos/:codigo', (req, res) => {
  const codigo = req.params.codigo;
  const pedidos = cargarPedidos();
  const pedido = pedidos.find(p => p.codigo === codigo || p.orderId === codigo);

  if (pedido) {
    res.json(pedido);
  } else {
    res.status(404).json({error: 'Pedido no encontrado'});
  }
});

// IMPORTANTE: Debes instalar node-fetch (npm install node-fetch)
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

app.get('/api/obtenerPedidos', async (req, res) => {
  try {
    const sucursal = req.query.sucursal || 'ALL';

    const url = `https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec?action=getPedidos&sucursal=${sucursal}`;

    const response = await fetch(url);
    const data = await response.json();

    res.json(data);
  } catch (err) {
    console.log("Error al obtener pedidos:", err);
    res.status(500).json({ error: 'Error al obtener pedidos.' });
  }
});

app.delete('/api/pedidos/:codigo', (req, res) => {
  const codigo = req.params.codigo;
  let pedidos =cargarPedidos();

  const idx = pedidos.findIndex(p => p.codigo === codigo || p.orderId === codigo);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
  }

  const eliminado = pedidos.splice(idx, 1)[0];
  guardarPedidos(pedidos);

  io.emit('pedido_eliminado', eliminado);

  res.json({ success: true, pedido: eliminado });
})

app.post('/api/cancelarPedido', async (req, res) => {
  const { codigoPedido, motivo } = req.body;
  const WEBHOOK_URL = 'https://webhook.site/e45ed4d4-7a0b-4258-b03a-f4fa20a53a41';

  if (!codigoPedido || !motivo) {
    return res.status(400).json({ success: false, error: 'Faltan datos' });
  }

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        codigoPedido,
        motivo,
        timestamp: new Date().toISOString()
      })
    });

    const sheetsResp = await fetch('https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `action=actualizarEstadoPedido&codigo=${encodeURIComponent(codigoPedido)}&nuevoEstado=Cancelado`
    });
    const sheetsData = await sheetsResp.json();
    if (sheetsData.estado !== 'ESTADO_ACTUALIZADO') {
      return res.status(500).json({ success: false, error: 'No se pudo actualizar el estado en Sheets.' });
    }

    let pedidos = cargarPedidos();
    const idx = pedidos.findIndex(p => p.codigo === codigoPedido || p.orderId === codigoPedido);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    }
    const eliminado = pedidos.splice(idx, 1)[0];
    guardarPedidos(pedidos);

    io.emit('pedido_eliminado', eliminado);

    res.json({ success: true });
  } catch (err) {
    console.error("Error en cancelarPedido:", err);
    res.status(500).json({ success: false, error: 'Error al cancelar el pedido.' });
  }
});

app.post('/api/verificarPassword', async (req, res) => {
  const { email, password } = req.body;
  try {
    const response = await fetch('https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'verificarPassword',
        email,
        password
      })
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error al verificar la contraseña.' });
  }
});

app.post('/api/cambiarPassword', async (req, res) => {
  const { email, nuevaPassword} = req.body;

  try {
    const response = await fetch('https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'cambiarPassword',
        email,
        nuevaPassword
      })
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Error al cambiar la contraseña.' });
  }
});

app.get('/api/corte', async (req, res) => {
  const sucursal = req.query.sucursal;
  if (!sucursal) {
    return res.status(400).json({ error: 'Falta el parámetro de sucursal' });
  }

  try {
    // Cambia la URL a la de tu Apps Script
    const url = `https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec?action=getPedidos&sucursal=${encodeURIComponent(sucursal)}&estados=liberado`;
    const response = await fetch(url);
    const data = await response.json();
    const pedidos = Array.isArray(data.pedidos) ? data.pedidos : [];

    let efectivo = 0, tarjeta = 0;
    pedidos.forEach(p => {
      const pago = (p.pago || p.payMethod || '').toLowerCase();
      const totalPedido = parseFloat(p.total) || 0;
      if (pago === 'efectivo') efectivo += totalPedido;
      else if (pago === 'tarjeta') tarjeta += totalPedido;
    });

    const total = efectivo + tarjeta;
    res.json({
      efectivo: efectivo.toFixed(2),
      tarjeta: tarjeta.toFixed(2),
      total: total.toFixed(2)
    });
  } catch (err) {
    console.error("Error en corte desde sheets:", err);
    res.status(500).json({ error: 'Error al obtener el corte desde Sheets.' });
  }
});;

app.post('/api/enviarCorte', async (req, res) => {
  try {
    const { sucursal, nombreDestinatario, correoDestinatario } = req.body;
    if (!sucursal || !correoDestinatario) {
      return res.status(400).json({ error: 'Faltan datos para enviar el corte' });
    }

    // 1. Pide los pedidos liberados a tu Apps Script
    const corteResp = await fetch('https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec?action=getPedidos&sucursal=' + encodeURIComponent(sucursal) + '&estados=liberado');
    const data = await corteResp.json();

    // 2. Calcula el corte igual que en tu /api/corte
    let efectivo = 0, tarjeta = 0;
    const pedidos = Array.isArray(data.pedidos) ? data.pedidos : [];
    pedidos.forEach(p => {
      const pago = (p.pago || p.payMethod || '').toLowerCase();
      const totalPedido = parseFloat(p.total) || 0;
      if (pago === 'efectivo') efectivo += totalPedido;
      else if (pago === 'tarjeta') tarjeta += totalPedido;
    });
    const total = efectivo + tarjeta;

    // 3. Genera el PDF y envía por correo
    let buffers = [];
    const doc = new PDFDocument();
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', async () => {
      const pdfData = Buffer.concat(buffers);

      let transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: 'dannyglezhdzo@gmail.com', // Cambia por tu correo real
          pass: 'jexh anjd wkqi znof'      // Contraseña de aplicación
        }
      });

      await transporter.sendMail({
        from: 'Sushi Soru Restaurant <dannglezhdzo@gmail.com>',
        to: correoDestinatario,
        subject: `Corte de caja - ${sucursal}`,
        text: `Corte de caja generado por ${nombreDestinatario || correoDestinatario}`,
        attachments: [
          {
            filename: `Corte_${sucursal}_${new Date().toISOString().substring(0, 10)}.pdf`,
            content: pdfData
          }
        ]
      });

      res.json({ enviado: true });
    });

    doc.fontSize(20).text(`Corte de caja - ${sucursal}`, {align: 'center'});
    doc.moveDown();
    doc.fontSize(14).text(`Fecha: ${new Date().toLocaleString()}`);
    doc.moveDown();
    doc.text(`Ventas en efectivo: $${efectivo.toFixed(2)}`);
    doc.text(`Ventas con tarjeta: $${tarjeta.toFixed(2)}`);
    doc.text(`Total de ventas: $${total.toFixed(2)}`);
    doc.end();
  } catch (err) {
    console.error("Error al enviar el corte:", err);
    res.status(500).json({ error: 'Error al enviar el corte.' });
  }
});

app.get('/api/pedidos.json', (req, res) => {
  const pedidos = cargarPedidos();
  res.json(pedidos);
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
