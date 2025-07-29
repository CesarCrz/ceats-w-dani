function generateQR(text, element) {
    const typeNumber = 0;
    const errorCorrectionLevel = 'L';
    const qr = qrcode(typeNumber, errorCorrectionLevel);
    qr.addData(text);
    qr.make();
    element.innerHTML = qr.createImgTag(3);
}

function fillOrderData(orderData) {
  console.log("Datos recibidos:", JSON.stringify(orderData, null, 2));
  const fecha = orderData.fecha
    ? new Date(orderData.fecha).toLocaleDateString('es-MX')
    : new Date().toLocaleDateString('es-MX');

  const hora = orderData.hora
    ? orderData.hora
    : new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit'});

  // Asignación de datos básicos
  document.getElementById("sucursal").textContent = orderData.sucursal || "Sucursal desconocida";
  document.getElementById("orderId").textContent = orderData.codigo || orderData.orderId || orderData.idPedido || "—";
  document.getElementById("deliverTo").textContent = orderData.deliverTo || "—";

  const fechaYhora = `${fecha} ${hora}`.trim();
  document.getElementById("orderDate").textContent = fechaYhora || "Fecha no disponible";
  document.getElementById("customerName").textContent = orderData.nombre || "—";
  document.getElementById("customerPhone").textContent = orderData.celular || orderData.numero || "—";
  document.getElementById("customerAddress").textContent = orderData.domicilio || "—";
  document.getElementById("instructionsText").textContent = orderData.instrucciones || "—";
  document.getElementById("paymentMethod").textContent = orderData.metodoPago || "—";
  document.getElementById("specs").textContent = orderData.instrucciones || "—";

  // Tipo de pedido
  console.log("Valor de tipo:", orderData.tipo);
  const tipo = (orderData.tipo || "").toLowerCase();
  const orderTypeDiv = document.getElementById("orderType");

  if (["delivery", "domicilio"].includes(tipo)) {
    orderTypeDiv.textContent = "PEDIDO A DOMICILIO";
    orderTypeDiv.className = "order-type order-type-delivery";
  } else if (["pickup", "recolectar", "sucursal", "recoger"].includes(tipo)) {
    orderTypeDiv.textContent = "PEDIDO A RECOGER";
    orderTypeDiv.className = "order-type order-type-pickup";
  } else {
    orderTypeDiv.textContent = "PEDIDO";
    orderTypeDiv.className = "order-type";
  }

  // Pedido urgente
  const urgente = orderData.urgente?.toString().toLowerCase() === "true";
  const urgentDiv = document.getElementById("urgentOrder");
  urgentDiv.style.display = urgente ? "block" : "none";

  // Lista de productos
  const itemsContainer = document.getElementById("orderItems");
  itemsContainer.innerHTML = "";

  let subtotal = 0;

  if (Array.isArray(orderData.pedido)) {
    orderData.pedido.forEach(item => {
      const cantidad = parseInt(item.cantidad) || 1;
      const subtotalItem = parseFloat(item.subtotal) || 0;

      subtotal += subtotalItem; // <-- ¡Agrega esta línea!

      const itemHTML = `
        <div class="item">
          <div><strong>${cantidad}x</strong> ${item.platillo}</div>
          ${item.opciones ? `<div class="item-options">Opciones: ${item.opciones}</div>` : ""}
          ${Array.isArray(item.complementos) && item.complementos.length > 0
            ? `<div class="item-complementos">Complementos: ${item.complementos.join(', ')}</div>`
            : ""}
          <div class="item-price">$${subtotalItem.toFixed(2)}</div>
        </div>
      `;
      itemsContainer.innerHTML += itemHTML;
    });
  }

  // Mostrar totales corregidos
  document.getElementById("subtotal").textContent = `$${subtotal.toFixed(2)}`;

  const envio = 0;
  const descuento = 0;
  const totalFinal = subtotal + envio - descuento;

  const qrSucural = {
    'ITESO': "https://search.google.com/local/writereview?placeid=ChIJuyCj3uSsKIQRh4qbtLpZxgI", 
    'TESORO': "https://search.google.com/local/writereview?placeid=ChIJLygLDN2tKIQRlegYv8dOXLo"
  }

  document.getElementById("deliveryFee").textContent = `$${envio.toFixed(2)}`;
  document.getElementById("discount").textContent = `$${descuento.toFixed(2)}`;
  document.getElementById("totalAmount").textContent = `$${totalFinal.toFixed(2)}`;

  const qrContainer = document.getElementById('qrCode');
  if (qrContainer) {
    const sucursalQR = (orderData.sucursal || '').toUpperCase().trim();
    const url = qrSucural[sucursalQR] || sucursalQR['TESORO'];
    generateQR(url, qrContainer);
  }
}

function autoPrint() {
    const msg = document.createElement('div');
    msg.textContent = 'Imprimiendo...';
    msg.style.position = 'fixed';
    msg.style.top = '10px';
    msg.style.left = '10px';
    msg.style.background = '#ffd';
    msg.style.padding = '10px';
    msg.style.xIndex = 9999;
    document.body.appendChild(msg);

    console.log('🖨️ Llamando a window.print() para imprimir el ticket...');
    setTimeout(() => {
        msg.remove();
        window.print();
    }, 500);
}

window.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'PRINT_ORDER') {
    fillOrderData(event.data.orderData);

    const autoPrintPref = localStorage.getItem('autoPrintEnabled');
    const autoPrintActivo = autoPrintPref === 'true' || event.data.autoPrint

    if (autoPrintActivo) {
      autoPrint();
    }
  }
});

// Datos de ejemplo para vista previa
const exampleOrder = {
    idPedido: 'SORU001',
    nombre: 'Juan Pérez',
    numero: '5555-1234',
    deliverTo: 'Recoger',
    domicilio: 'Av. General Ramón Corona 2514, Zapopan, Jalisco',
    sucursal: 'ITESO',
    metodoPago: 'Efectivo',
    total: '350.00',
    tipo: 'delivery',
    urgente: false,
    instrucciones: 'Sin cebolla, extra salsa de soya',
    fecha: '2025-07-14',
    hora: '13:00:00',
    pedido: [
      { platillo: 'California Roll', cantidad: 2, subtotal: '120.00' },
      { platillo: 'Sashimi de Salmón', cantidad: 1, subtotal: '150.00' },
      { platillo: 'Tempura de Camarón', cantidad: 1, subtotal: '80.00' }
    ]
};

fillOrderData(exampleOrder);