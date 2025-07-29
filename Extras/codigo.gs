const SHEET_NAME = 'Usuarios';
const HOJA_PEDIDOS = 'Pedidos';

function doPost(e) {
  try {
    let action, params;

    // Detectar si es JSON (Postman o app avanzada)
    if (e.postData.type === 'application/json') {
      params = JSON.parse(e.postData.contents);
      action = params.action;
    } else {
      // Si es tipo formulario (desde tu app actual)
      params = e.parameter;
      action = params.action;
    }

    // Login
    if (action === "login") {
      // const rest = params.rest;
      const email = params.email;
      const password = params.password;
      return validarUsuario(email, password);
    }

    // Registrar pedido
    if (action === "nuevoPedido") {
      return registrarPedido(params);
    }

    if (action === 'actualizarEstadoPedido') {
      return actualizarEstadoPedido(params);
    }

    // Verificar la contraseña
    if (action === 'verificarPassword') {
      const email= params.email;
      const password = params.password;

      return verificarPassword(email, password);
    }

    // Cambiar contraseña
    if (action === 'cambiarPassword') {
      const email = params.email;
      const nuevaPassword = params.nuevaPassword;
      return cambiarPassword(email, nuevaPassword);
    }

    return respuestaJSON({ estado: "SIN_ACCION_VALIDA" });

  } catch (error) {
    return respuestaJSON({ estado: "ERROR", mensaje: error.message });
  }
}

function doGet(e) {
  const action = e.parameter.action;
  if (action === "getPedidos") {
    return obtenerPedidos(e);
  }

  return ContentService.createTextOutput(
    JSON.stringify({ estado: "SIN_ACCION_VALIDA" })
  ).setMimeType(ContentService.MimeType.JSON);
}

function registrarPedido(params) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_PEDIDOS);

  // Extrae los campos principales de tu JSON estándar
  const {
    orderId,
    deliverOrRest,
    name,
    numero,
    sucursal,
    deliverTo,
    address,
    productDetails,
    total,
    currency,
    specs,
    payMethod
  } = params;


  //asignamos dia y hora
  const now = new Date(); 

  // 2. Formatea la fecha usando Utilities.formatDate para mayor fiabilidad.
  // 'dd/MM/yyyy' te da el formato deseado (ej. 18/07/2025)
  // Session.getScriptTimeZone() asegura que la fecha se base en la zona horaria de tu script.
  const fecha = Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd/MM/yyyy');

  // 3. Formatea la hora usando Utilities.formatDate.
  // 'hh:mm a' te da la hora en formato de 12 horas con AM/PM (ej. 10:09 PM)
  // Si prefieres 24 horas, usa 'HH:mm'.
  const hora = Utilities.formatDate(now, Session.getScriptTimeZone(), 'hh:mm a')


  // Validación: solo los campos realmente obligatorios (los que SÍ mandas)
  if (!orderId || !deliverOrRest || !name || !numero || !sucursal || !productDetails) {
    return respuestaJSON({ estado: "FALTAN_DATOS" });
  }

  // Convierte el pedido a string (para guardar en la hoja)
  const pedidoString = typeof productDetails === 'string' ? productDetails : JSON.stringify(productDetails);

  // declaramos estado
  const estado = 'Pendiente'

  // Agrega campos extra como columnas si quieres (recomendado)
  const order = {
    codigo: `SORU${orderId}`,
    deliverOrRest: deliverOrRest,              
    estado: estado,       
    nombre: name,       
    numero: numero,
    sucursal: sucursal,
    pedido: productDetails,
    specs: specs ? specs : '', 
    deliverTo: deliverTo ? deliverTo : '',      
    address: address ? address : '',   
    total: total,
    currency: currency,         
    payMethod: payMethod,
    date: fecha,         
    hour: hora,     
  }

  //apend al google sheets
  hoja.appendRow([
    order.codigo,
    order.deliverOrRest,
    order.estado,
    order.nombre,
    order.numero,
    order.sucursal,
    order.pedido,
    order.specs,
    order.deliverTo,
    order.address,
    order.total,
    order.currency,
    order.payMethod,
    order.date,
    order.hour
  ]);

  try {
    //const result = sendOrderAPI(order);
    // POR AHORA SE ESTA ENVIANDO DIRECTO DEL SERVIDOR PARA LA WEB-APP LO QUE QUIERE DECIR QUE EL SERVIDOR MANDA AQUI Y A LA WEB-APP
    Logger.log('Resultado backend: ' + result);
  } catch (e) {
    Logger.log('Error al enviar a backend: ' + e.message);
  }
  return respuestaJSON({ estado: "PEDIDO_REGISTRADO", orderId });
}

function obtenerPedidos(e) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_PEDIDOS);
  const datos = hoja.getDataRange().getValues();
  const pedidos = [];

  const sucursal = e.parameter.sucursal;
  const estados = (e.parameter.estados || '').split(',').map(s => s.trim().toLowerCase()).filter(s => s);

  for (let i = 1; i < datos.length; i++) {
    // Extrae los campos según el orden real
    const [
      codigo, deliverOrRest, estado, nombre, celular, sucursalFila, pedido, instruccion,
      entregarA, domicilio, total, currency, pago, fecha, hora, tiempo
    ] = datos[i];

    const matchEstado = estados.length === 0 ? true : estados.includes((estado || '').toLowerCase());
    const matchSucursal = (sucursal === 'ALL' || (sucursalFila || '').toUpperCase() === sucursal.toUpperCase());

    if (matchEstado && matchSucursal) {
      pedidos.push({
        codigo, deliverOrRest, estado, nombre, celular, sucursal: sucursalFila, pedido,
        instruccion, entregarA, domicilio, total, currency, pago, fecha, hora, tiempo
      });
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    estado: "OK",
    pedidos: pedidos
  })).setMimeType(ContentService.MimeType.JSON);
}

function validarUsuario(email, password) {
  // diccionario = { rest: 'nombre de la hoja perteneciente al restaurante' };

  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const datos = hoja.getDataRange().getValues();

  const COL_EMAIL = 0;
  const COL_PASS = 1;
  const COL_ROL = 2;
  const COL_SUCURSAL = 3;

  for (let i = 1; i < datos.length; i++) {
    const fila = datos[i];
    const emailHoja = fila[COL_EMAIL].toLowerCase().trim();
    const passHoja = fila[COL_PASS];

    if (email.toLowerCase().trim() === emailHoja) {
      if (password === passHoja) {
        return respuestaJSON({
          estado: "VALIDO",
          rol: fila[COL_ROL],
          sucursal: fila[COL_SUCURSAL]
        });
      } else {
        return respuestaJSON({ estado: "PASS_INVALIDA" });
      }
    }
  }

  return respuestaJSON({ estado: "NO_EXISTE_USUARIO" });
}

function actualizarEstadoPedido(params) {
  const codigo = params.codigo;
  const nuevoEstado = params.nuevoEstado;
  const tiempoEstimado = params.tiempoEstimado;

  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_PEDIDOS);
  const datos = hoja.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {
    if ((datos[i][0] + "") === codigo) { // Columna 0 = Codigo
      hoja.getRange(i + 1, 3).setValue(nuevoEstado); // Columna 3 = Estado
      if (nuevoEstado === "En preparacion" && tiempoEstimado) {
        hoja.getRange(i + 1, 16).setValue(tiempoEstimado); // Columna 16 = Tiempo
      }
      return ContentService.createTextOutput(JSON.stringify({ estado: "ESTADO_ACTUALIZADO" })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ estado: "NO_ENCONTRADO" })).setMimeType(ContentService.MimeType.JSON);
}

function respuestaJSON(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function sendOrderAPI(newOrder){
  const API = 'https://add41b75dd32.ngrok-free.app/api/pedidos/';
  const sucursal = newOrder.sucursal;
  const payload = JSON.stringify(newOrder);
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
    muteHttpExceptions: true
  };
  try {
    const response = UrlFetchApp.fetch(`${API}${sucursal}`, options);
    Logger.log(`se esta mandando a la url: ${response}`);
    if(response.getResponseCode() >= 200 && response.getResponseCode() < 300){
      return `ENVIADO CORRECTAMENTE. codigo: ${response.getResponseCode()}`;
    } else {
      return `ERROR AL MANDAR AL API. codigo: ${response.getResponseCode()}`;
    }
  } catch(e) {
    return `ERROR AL MANDAR AL API. codigo: ${e.message}`;
  }
}

function verificarPassword(email, password) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const datos = hoja.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {
    const fila = datos[i];
    const emailHoja = fila[0].toLowerCase().trim();
    const passHoja = fila[1];

    if ( email.toLowerCase().trim() === emailHoja) {
      if (password === passHoja) {
        return respuestaJSON({ valido: true });
      } else {
        return respuestaJSON({ valido: false });
      }
    }
  }
  return respuestaJSON({ valido: false });
}


function cambiarPassword(email, nuevaPassword) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const datos = hoja.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0].toLowerCase().trim() === email.toLowerCase().trim()) {
      hoja.getRange(i + 1, 2).setValue(nuevaPassword);
      return respuestaJSON({ cambiado: true });
    }
  }
  return respuestaJSON({ cambiado: false, error: 'Usuario no encontrado' });
}
