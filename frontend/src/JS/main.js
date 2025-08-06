if (window.__mainJsAlreadyLoaded__) {
  console.warn("⚠️ main.js ya fue cargado antes, deteniendo ejecución duplicada.");
  throw new Error("main.js already loaded");
}
window.__mainJsAlreadyLoaded__ = true;

let tiempoActual = 0;
let pedidosPrevios = [];
let pedidosAceptados = {};
let actualizandoEstado = false;
let ignoreNextPopupListoClose = false;
let sonidoActivo = localStorage.getItem('sonidoActivado') === 'true';
let socket;

const emailSucursales = {
  'ITESO' : 'sushisoru@gmail.com',
  'TESORO' : 'sushisoruT@gmail.com'
}

function normalizarEstado(estado) {
  return (estado || "")
    .toLowerCase()                     // todo minúsculas
    .normalize("NFD")                  // separa letras y tildes
    .replace(/[\u0300-\u036f]/g, "");  // elimina las tildes
}

// Desbloquear el audio tras la primera interacción del usuario (mejorado)
function desbloquearAudio() {
  const audio = document.getElementById('newOrderSound');
  if (audio) {
    audio.play().then(() => {
      audio.pause();
      audio.currentTime = 0;
      document.body.removeEventListener('click', desbloquearAudio);
      document.body.removeEventListener('keydown', desbloquearAudio);
      document.body.removeEventListener('touchstart', desbloquearAudio);
    }).catch(() => {});
  }
}
document.body.addEventListener('click', desbloquearAudio);
document.body.addEventListener('keydown', desbloquearAudio);
document.body.addEventListener('touchstart', desbloquearAudio);

// Función para esperar a que el DOM esté completamente cargado
function waitForDOM() {
  return new Promise((resolve) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', resolve);
    } else {
      resolve();
    }
  });
}

// Función para esperar a que un elemento específico exista
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const element = document.getElementById(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const element = document.getElementById(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Timeout para evitar esperas infinitas
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Elemento ${selector} no encontrado después de ${timeout}ms`));
    }, timeout);
  });
}

// Función principal que se ejecuta cuando todo está listo
async function initializeApp() {
  try {
    console.log("🚀 Inicializando aplicación...");
    await waitForDOM();
    console.log("✅ DOM cargado");
    const grid = await waitForElement('preparacionGrid');
    const empty = await waitForElement('preparacionEmpty');
    console.log("✅ Elementos del DOM encontrados:", { grid: !!grid, empty: !!empty });
    socket = io();
    console.log("✅ Socket inicializado");
    const pedidoPopup = document.getElementById('pedidoPopup');
    if (pedidoPopup) pedidoPopup.style.display = 'none';
    const pedidoPopupListo = document.getElementById('pedidoPopupListo');
    if (pedidoPopupListo) pedidoPopupListo.style.display = 'none';
    setupSocketListeners();
    setupApp();
    renderPedidosListo();
  } catch (error) {
    console.error("❌ Error inicializando la aplicación:", error);
    createMissingElements();
  }
}

async function crearPedido(nuevoPedido) {
  const sucursal = nuevoPedido.sucursal;
  const response = await fetch(`/api/pedidos/${encodeURIComponent(sucursal)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nuevoPedido)
  });
  if (response.ok) {
    alert('Pedido registrado correctamente');
    cargarPedidosEnPreparacion(sucursal);
  } else {
    alert('Error al registrar el pedido');
  }
}

function createMissingElements() {
  console.log("🔧 Intentando crear elementos faltantes...");
  const mainContainer = document.querySelector('main') || document.querySelector('.container') || document.body;
  if (!document.getElementById('preparacionGrid')) {
    const grid = document.createElement('div');
    grid.id = 'preparacionGrid';
    grid.className = 'orders-grid';
    mainContainer.appendChild(grid);
    console.log("✅ preparacionGrid creado");
  }
  if (!document.getElementById('preparacionEmpty')) {
    const empty = document.createElement('div');
    empty.id = 'preparacionEmpty';
    empty.className = 'empty-state';
    empty.style.display = 'flex';
    empty.innerHTML = `
      <div class="empty-content">
        <h3>No hay pedidos en preparación</h3>
        <p>Los nuevos pedidos aparecerán aquí</p>
      </div>
    `;
    mainContainer.appendChild(empty);
    console.log("✅ preparacionEmpty creado");
  }
}

function setupSocketListeners() {
  socket.on('new_order', (pedido) => {
    console.log('🆕 Pedido recibido por socket:', pedido);
    const sucursalUsuario = (localStorage.getItem('sucursal') || '').toLowerCase();
    const rol = (localStorage.getItem('rol') || '').toLowerCase();

    if (rol !== 'admin' && (pedido.sucursal || '').toLowerCase() !== sucursalUsuario) {
      return; // Ignora pedidos de otras sucursales
    }

    if (typeof pedido.productDetails === 'string') {
      try{
        pedido.pedido = JSON.parse(pedido.productDetails);
      } catch (e) {
        pedido.pedido = [];
      }
    } else if (Array.isArray(pedido.productDetails)) {
      pedido.pedido = pedido.productDetails;
    } else if (typeof pedido.pedido === 'string') {
      try {
        pedido.pedido = JSON.parse(pedido.pedido);
      } catch  (e) {
        pedido.pedido = [];
      }
    } else if (Array.isArray(pedido.pedido)) {
    } else {
      pedido.pedido = [];
    }

    // Normaliza el pedido para que siempre tenga las mismas propiedades
    const normalizado = {
      codigo: pedido.codigo || pedido.orderId,
      nombre: pedido.nombre || pedido.name,
      estado: pedido.estado,
      fecha: pedido.fecha,
      hora: pedido.hora,
      celular: pedido.celular,
      pedido: pedido.pedido,
      sucursal: pedido.sucursal
    };

    if (pedidosPrevios.some(p => p.codigo === normalizado.codigo)) {
      console.log('Evitar duplicados');
      return;
    }

    pedidosPrevios.push(normalizado);

    const grid = document.getElementById("preparacionGrid");
    const empty = document.getElementById("preparacionEmpty");

    if (!grid || !empty) {
      console.warn("⚠️ Elementos del DOM no disponibles, creando...");
      createMissingElements();
      setTimeout(() => handleNewOrder(normalizado), 100);
      return;
    }

    const audio = document.getElementById("newOrderSound");
    if (audio && sonidoActivo) {
      audio.pause();
      audio.currentTime = 0;
      audio.loop = true;
      audio.play().catch(err => console.warn('⚠️ No se pudo reproducir el sonido: ', err));
    }

    handleNewOrder(normalizado);
  });
}

// TOAST TOP RIGHT - Personalizable (toast-noti)
function showToastTopRight({ 
  message = '', 
  duration = 3500, 
  background = '#0066ff', // color de fondo por default
  color = '#fff'          // color de texto por default
} = {}) {
  let container = document.getElementById('toastNoti');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastNoti';
    container.className = 'toast-noti';
    document.body.appendChild(container);
  }

  // Crear el toast individual
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.background = background;
  toast.style.color = color;

  toast.innerHTML = `
    <span>${message}</span>
    <button class="close-toast" title="Cerrar">&times;</button>
  `;

  // Cerrar manualmente al dar clic en la X
  toast.querySelector('.close-toast').onclick = () => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  };

  container.appendChild(toast);
  // Mostrar con animación
  setTimeout(() => toast.classList.add('show'), 30);

  // Ocultar automáticamente después de duration
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

function showToast(msg = '', duration = 3500) {
  const toast = document.getElementById('toastNotification');
  if (!toast) return;
  toast.innerHTML = msg;
  toast.style.opacity = '1';
  toast.style.bottom = '40px';
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.bottom = '20px';
  }, duration);
}

function handleNewOrder(pedido) {
  const grid = document.getElementById("preparacionGrid");
  const empty = document.getElementById("preparacionEmpty");

  // Elimina solo las tarjetas de pedido, no el empty
  grid.querySelectorAll('.order-card').forEach(card => card.remove());

  if (pedidosPrevios.length === 0) {
    if (empty) empty.style.display = "flex";
  } else {
    if (empty) empty.style.display = "none";
    pedidosPrevios.forEach(p => {
      const card = document.createElement("div");
      card.className = "order-card " + (p.estado === "Pendiente" ? "modern-green" : "preparacion");
      // SIEMPRE usa el orderId o codigo, nunca el idPedido
      card.setAttribute('data-codigo', p.codigo || p.orderId); // sin #

      let cronometroHTML = '';
      if (p.estado === "En preparacion") {
        const inicio = parseInt(localStorage.getItem(`pedido_${p.codigo}_inicio`), 10);
        const minutos = parseInt(localStorage.getItem(`pedido_${p.codigo}_minutos`), 10) || 15;
        let minutosRestante = minutos;
        if (inicio) {
          const transcurrido = Math.floor((Date.now() - inicio) / 60000);
          minutosRestante = Math.max(minutos - transcurrido, 0)
        }
        cronometroHTML = `
          <div class="cronometro-top-right">
            <span class="cronometro-label-mini">Listo en</span>
            <span class="cronometro-tiempo-mini">${minutosRestante} min</span>
          </div>
        `;
      }

      card.innerHTML = `
      ${cronometroHTML}
        <div class="pedido-header">
          <div class="pedido-codigo">${p.codigo}</div>
          <div class="pedido-nombre">${p.nombre}</div>
          <div class="pedido-sucursal">${p.sucursal || 'Sucursal no especificada'}</div>
        </div>
        <div class="pedido-footer">
          <span class="ver-detalles" data-nombre="${p.nombre}" data-codigo="${p.codigo}">Ver detalles</span>
        </div>
      `;
      grid.appendChild(card);
    });
  }
}

function setupApp() {
  const email = localStorage.getItem('email');
  const rol = localStorage.getItem('rol');
  const sucursal = localStorage.getItem('sucursal');
  console.log('Email:', email);
  console.log('Rol:', rol);
  console.log('Sucursal:', sucursal);

  if (!email || !rol || !sucursal) {
    alert('Debes iniciar sesión primero.');
    window.location.href = '/';
    return;
  }

  // Configurar elementos de UI de forma segura
  const userDisplayName = document.getElementById('userDisplayName');
  if (userDisplayName) {
    userDisplayName.textContent = email;
  }

  const sucursalHeader = document.getElementById('sucursalHeader');
  if (sucursalHeader) {
    if (rol === 'admin') {
      sucursalHeader.textContent = `Administrador`;
    } else {
      sucursalHeader.textContent = sucursal ? `Sucursal: ${sucursal}` : 'undefined';
    }
  }

  if (rol !== 'admin') {
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    const adminPanel = document.getElementById('adminPanel');
    if (adminPanelBtn) adminPanelBtn.style.display = 'none';
    if (adminPanel) adminPanel.style.display = 'none';
  }

  const userMenuBtn = document.getElementById("userMenuBtn");

  // Protege contra duplicados
  if (userMenuBtn && !userMenuBtn.dataset.listenerAdded) {
    userMenuBtn.dataset.listenerAdded = "true"; // marca como "ya tiene listener"

    userMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // console.log("✅ Click en menú");
      const dropdown = document.getElementById("userDropdown");
      if (dropdown) {
        dropdown.classList.toggle("visible"); 
      }
    });
  }

  const userDropdown = document.getElementById("userDropdown");
  if (userDropdown) {
    userDropdown.addEventListener("click", function(e) {
      // Si se clickea una opción del menú, ciérralo
      if (e.target.closest(".user-dropdown-item")) {
        userDropdown.classList.remove("visible");
      }
    });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('email');
      localStorage.removeItem('rol');
      localStorage.removeItem('sucursal');
      // alert('Has cerrado sesión correctamente.');
      window.location.href = '/';
    });
  }

  const btnAdmin = document.getElementById('adminPanelBtn');
  const volverDesdeAdmin = document.getElementById('volverDesdeAdmin');
  const allTabs = document.querySelectorAll('.tab-content');
  const adminPanel = document.getElementById('adminPanel');
  const pedidosActivos = document.getElementById('pedidosActivos'); // Puedes cambiar por otra tab si quieres volver a otra

  if (btnAdmin && adminPanel) {
    btnAdmin.addEventListener('click', async () => {
      // console.log('Click en el boton de admin')
      allTabs.forEach(tab => tab.classList.remove('active'));
      adminPanel.classList.add('active');
      adminPanel.style.display = 'block'
      // actualizarEstadisticasAdmin()
      await obtenerPedidosParaEstadisticas();
      // renderEstadisticas(pedidos);
    });
  }

  const btnCorte = document.getElementById('corte');
  const popupCorte = document.getElementById('popupCorte');
  btnCorte.addEventListener('click', () => {
    popupCorte.style.display = 'flex';
    mostrarPopupCorte();
  });

  if (volverDesdeAdmin && pedidosActivos) {
    volverDesdeAdmin.addEventListener('click', () => {
      allTabs.forEach(tab => tab.classList.remove('active'));
      pedidosActivos.classList.add('active');
    });
  }


  // Configurar tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const target = document.getElementById(targetId);
      if (target) {
        target.classList.add('active');
      }
    });
  });

  // Configurar controles de tiempo
  const incrementarTiempo = document.getElementById('incrementarTiempo');
  const decrementarTiempo = document.getElementById('decrementarTiempo');
  const btnAceptar = document.getElementById('btn-aceptar');
  const cerrarPopup = document.getElementById('cerrarPopup');

  // Función para manejar el botón Aceptar/Listo
  if (btnAceptar) {
    btnAceptar.addEventListener('click', function () {
      const estado = this.getAttribute('data-estado');
      const codigo = this.getAttribute('data-codigo');

      if (!codigo) return;

      // Dentro del evento click del botón Aceptar/Listo:
      if (estado === 'pendiente') {
        if (tiempoActual === 0) {
          showToastTopRight({
            message: 'Por favor, ajusta el tiempo antes de aceptar el pedido.',
            duration: 3500,
            background: '#ef4444',
            color: '#fff'
          })
          return;
        }

        actualizandoEstado = true;
        document.body.classList.add('cursor-bloqueado');

        // Guardar en localStorage
        localStorage.setItem(`pedido_${codigo}_inicio`, Date.now());
        localStorage.setItem(`pedido_${codigo}_minutos`, tiempoActual);
        localStorage.setItem(`pedido_${codigo}_estado`, 'En preparacion');

        // 1. ACTUALIZAR EN EL BACKEND LOCAL Y EN EL JSON
        fetch(`/api/pedidos/${codigo}/estado`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estado: 'En preparacion', tiempoEstimado: tiempoActual })
        })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              // 2. ACTUALIZAR EN GOOGLE SHEETS (APPS SCRIPT)
              return fetch('https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `action=actualizarEstadoPedido&codigo=${encodeURIComponent(codigo)}&nuevoEstado=En%20preparacion&tiempoEstimado=${encodeURIComponent(tiempoActual)}`
              }).then(res => res.json());
            } else {
              throw new Error('No se pudo actualizar el estado en el backend local.');
            }
          })
          .then(dataSheet => {
            if (dataSheet && dataSheet.estado === "ESTADO_ACTUALIZADO") {
              // Actualizar la interfaz
              const pedido = pedidosPrevios.find(p => p.codigo === codigo);
              if (pedido) {
                pedido.estado = 'En preparacion';
                handleNewOrder(pedido);
              }
              actualizarContadorPreparacion(pedidosPrevios);
              const popup = document.getElementById('pedidoPopup');
              if (popup) popup.style.display = 'none';
            } else {
              alert('No se pudo actualizar el estado en Google Sheets.');
            }
          })
          .catch(err => {
            alert(err.message || 'Error al actualizar el estado.');
          })
          .finally(() => {
            actualizandoEstado = false;
            document.body.classList.remove('cursor-bloqueado');
          });
      } else if (estado === 'preparacion') {
        actualizandoEstado = true;
        document.body.classList.add('cursor-bloqueado');

        // 1. Actualiza en backend local y JSON
        fetch(`/api/pedidos/${codigo}/estado`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estado: 'Listo' })
        })
          .then(res => res.json())
          .then(data => {
            if (!data.success) throw new Error('No se pudo actualizar el estado en el backend local.');
            // 2. Actualiza en Google Sheets
            return fetch('https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `action=actualizarEstadoPedido&codigo=${encodeURIComponent(codigo)}&nuevoEstado=Listo`
            }).then(res => res.json());
          })
          .then(dataSheet => {
            if (!dataSheet || dataSheet.estado !== "ESTADO_ACTUALIZADO") {
              throw new Error('No se pudo actualizar el estado a Listo en Google Sheets.');
            }
            // 3. Refresca los pedidos desde la fuente (para asegurar datos frescos)
            return fetch(`/api/pedidos/${codigo}`)
              .then(res => res.json())
              .then(pedidoListo => {
                // Quita el pedido de pedidosPrevios (en preparación)
                pedidosPrevios = pedidosPrevios.filter(p => p.codigo !== codigo);
                // Opcional: podrías tener un array pedidosListos, o solo renderizar los "Listos" directamente
                // 4. Renderiza ambos paneles
                cargarPedidosEnPreparacion(rol === 'admin' ? 'ALL' : sucursal); // refresca panel en preparación
                renderPedidosListo(); // refresca panel de listos
                const popup = document.getElementById('pedidoPopup');
                if (popup) popup.style.display = 'none';
              });
          })
          .catch(err => {
            alert(err.message || 'Error al actualizar el estado.');
          })
          .finally(() => {
            actualizandoEstado = false;
            document.body.classList.remove('cursor-bloqueado');
          });
      } else if (estado === 'listo') {
        mostrarPopupPedidoListo(pedido);
      }
    });
  }

  if (incrementarTiempo) {
    incrementarTiempo.addEventListener('click', () => {
      if (tiempoActual < 55) {
        tiempoActual += 5;
        actualizarTiempoDisplay();
      }
    });
  }


  if (decrementarTiempo) {
    decrementarTiempo.addEventListener('click', () => {
      if (tiempoActual > 0) {
        tiempoActual -= 5;
        actualizarTiempoDisplay();
      }
    });
  }

  if (cerrarPopup) {
    cerrarPopup.addEventListener("click", () => {
      const popup = document.getElementById("pedidoPopup");
      if (popup) {
        popup.style.display = "none";
      }
    });
  }

  const btnAjustar = document.getElementById('btn-ajustar');
  if (btnAjustar) {
    btnAjustar.addEventListener('click', function() {
      mostrarSelectorTiempo(true);
      const btnAceptar = document.getElementById('btn-aceptar');
      if (btnAceptar) {
        btnAceptar.textContent = 'Aceptar';
        btnAceptar.classList.remove('en-preparacion');
        btnAceptar.disabled = false;
      }
    });
  }

  const btnChangePassword = document.getElementById('cambiarContraseña');
  const passwordModal = document.getElementById('passwordModal');
  const passwordForm = document.getElementById('passwordForm');
  const closeModalBtn = document.getElementById('closeModalPassword');
  const btnConfirm = document.getElementById('btn-confirm');

  if (btnChangePassword && passwordModal) {
    btnChangePassword.addEventListener('click', () => {
      if (passwordForm) passwordForm.reset();
      passwordModal.style.display = 'flex'; // o 'block' según tu CSS
      console.log('🟢 Abriendo modal de cambio de contraseña');
    });

    passwordModal.addEventListener('click', (e) => {
      if (e.target === passwordModal) {
        passwordModal.style.display = 'none';
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && passwordModal.style.display === 'flex') {
        passwordModal.style.display = 'none';
      }
    });

    if (closeModalBtn) {
      closeModalBtn.addEventListener('click', () => {
        passwordModal.style.display = 'none';
      });
    }
  }

  btnConfirm.addEventListener('click', () => {
    const actualPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;
    const estadoPassword = document.getElementById('estadoPassword');
    const email = localStorage.getItem('email');
    const profileSelect = document.getElementById('profile').value;
    estadoPassword.textContent = '';

    // IF PARA VERIFICAR QUE EL SELECT SEA VALIDO
    if (profileSelect === '') {
      estadoPassword.textContent = 'Por favor, selecciona un perfil.';
      estadoPassword.style.color = 'var(--danger)';
      estadoPassword.timeout = setTimeout(() => {
        estadoPassword.textContent = '';
      }, 3000);
      return;
    } 

    // IF PARA VERIFICAR QUE LOS CAMPOS DE LAS CONTRASEÑAS ESTEN LLENOS
    if (!actualPassword || !newPassword || !confirmNewPassword) {
      estadoPassword.textContent = 'Por favor, completa todos los campos.';
      estadoPassword.style.color = 'var(--danger)';

      estadoPassword.timeout = setTimeout(() => {
        estadoPassword.textContent = '';
      }, 3000);
      return;
    }

    // EMAIL SEGUN PERFIL SELECCIONADO
    let emailSelected;
    if (profileSelect === 'Admin') {
      emailSelected = localStorage.getItem('email');
    } else if (profileSelect === 'ITESO' || profileSelect === 'TESORO') {
      emailSelected = emailSucursales[profileSelect];
    } else {
      estadoPassword.textContent = 'Por favor, selecciona un perfil.';
      estadoPassword.style.color = 'var(--danger)';
      estadoPassword.timeout = setTimeout(() => {
        estadoPassword.textContent = '';
      }, 3000);
      return;
    }
    
    // IF PARA CONFIRMAR LA CONTRASEÑA ACTUAL
    fetch('/api/verificarPassword', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'verificarPassword',
        email: emailSelected,
        password: actualPassword
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.valido) {
        fetch('/api/cambiarPassword', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: emailSelected,
            nuevaPassword: newPassword
          })
        })
        .then(res => res.json())
        .then(data => {
          if (data.cambiado) {
            estadoPassword.textContent = '¡Contraseña cambiada correctamente!';
            estadoPassword.style.color = 'var(--success)';
            estadoPassword.timeout = setTimeout(() => {
              passwordModal.style.display = 'none';
              estadoPassword.textContent = '';
            }, 3000);
          } else {
            estadoPassword.textContent = 'No se pudo cambiar la contraseña.';
            estadoPassword.style.color = 'var(--danger)';
            estadoPassword.timeout = setTimeout(() => {
              estadoPassword.textContent = '';
            }, 3000);
          }
        });
      } else {
        estadoPassword.textContent = 'La contraseña actual es incorrecta.';
        estadoPassword.style.color = 'var(--danger)';
        estadoPassword.timeout = setTimeout(() => {
          estadoPassword.textContent = '';
        }, 3000);
        return;
      }
    })

    // IF PARA VERIFICAR QUE LA NUEVA CONTRASEÑA Y LA CONFIRMACION COINCIDAN
    if (newPassword !== confirmNewPassword) {
      estadoPassword.textContent = 'Las contraseñas no coinciden.';
      estadoPassword.style.color = 'var(--danger)';
      estadoPassword.timeout = setTimeout(() => {
        estadoPassword.textContent = '';
      }, 3000);
    }

  });

  setInterval(() => {
    cargarPedidosEnPreparacion(rol === 'admin' ? 'ALL' : sucursal);
  }, 60000); // Actualizar cada 60 segundos

  cargarPedidosEnPreparacion(rol === 'admin' ? 'ALL' : sucursal);
  setupOrderDetailsListener();
}

document.addEventListener('keydown', function(e) {
  const popup = document.getElementById("pedidoPopup");
  if (!popup) return;
  if ((popup.style.display === 'flex' || popup.style.display === 'block') && e.key === 'Escape') {
    popup.style.display = 'none';
  }
});

document.addEventListener('click', function(e) {
  const popup = document.getElementById('pedidoPopup');
  if (!popup) return;
  // Solo cierra si el click fue en el overlay (popup) y no en el contenido interno
  if ((popup.style.display === 'flex' || popup.style.display === 'block') && e.target === popup) {
    popup.style.display = 'none';
  }
});

document.addEventListener('click', function (e) {
  const popupListo = document.getElementById('pedidoPopupListo');
  if (!popupListo || popupListo.style.display !== 'flex') return;

  const clickedInside = popupListo.querySelector('.popup-card-listo')?.contains(e.target);

  if (ignoreNextPopupClose) {
    ignoreNextPopupClose = false;
    return;
  }

  if (!clickedInside) {
    popupListo.style.display = 'none';
  }
});


function setupOrderDetailsListener() {
  // Oculta ambos popups al cargar la app o después de recargar
  const popupNormal = document.getElementById('pedidoPopup');
  const popupListo = document.getElementById('pedidoPopupListo');
  if (popupNormal) popupNormal.style.display = 'none';
  if (popupListo) popupListo.style.display = 'none';

  document.addEventListener('click', async e => {
    const card = e.target.closest('.order-card');
    if (!card || actualizandoEstado) return;
    if (card.hasAttribute('data-historial')) return;
    e.stopPropagation();

    const codigo = card.getAttribute('data-codigo');
    if (!codigo) return;

    try {
      const res = await fetch(`/api/pedidos/${codigo}`);
      // console.log('Elemento clickeado:', card);
      // console.log('data-codigo:', card.getAttribute('data-codigo'));
      if (!res.ok) throw new Error('No se encontró el pedido');
      const pedido = await res.json();

      // Primer chequeo: ¿el pedido está listo?
      const estadoReal = normalizarEstado(pedido.estado);

      // Oculta ambos popups antes de mostrar el que corresponde
      if (popupNormal) popupNormal.style.display = 'none';
      if (popupListo) popupListo.style.display = 'none';

      // Si es "Listo", muestra solo el popup "Listo" y termina (CON EL FIX)
      if (estadoReal === 'listo') {
        setTimeout(() => mostrarPopupPedidoListo(pedido), 0);
        return;
      }

      // Si no es "Listo", ejecuta la lógica normal de popup
      const popupTitulo = document.getElementById('popupTitulo');
      if (popupTitulo) popupTitulo.textContent = `${pedido.nombre} • ${pedido.codigo}`;

      const btnAceptar = document.getElementById('btn-aceptar');
      const btnAjustar = document.getElementById('btn-ajustar');
      const btnImprimir = document.getElementById('btnImprimirPopup');
      const timeControls = document.querySelector('.time-controls');

      console.log('pedido.estado:', pedido.estado, '| normalizado:', estadoReal);

      if (btnAceptar) {
        btnAceptar.setAttribute('data-codigo', pedido.codigo);

        if (estadoReal === 'en preparacion') {
          btnAjustar && (btnAjustar.style.display = 'inline-flex');
          btnImprimir && (btnImprimir.style.display = 'inline-flex');

          const tiempoGuardado = parseInt(localStorage.getItem(`pedido_${pedido.codigo}_minutos`), 10) || 15;
          const inicioGuardado = localStorage.getItem(`pedido_${pedido.codigo}_inicio`);
          let minutosRestante = tiempoGuardado;

          if (inicioGuardado) {
            const inicioMs = parseInt(inicioGuardado, 10);
            const transcurrido = Math.floor((Date.now() - inicioMs) / 60000);
            minutosRestante = Math.max(tiempoGuardado - transcurrido, 0);
          }

          btnAceptar.textContent = 'Listo';
          btnAceptar.setAttribute('data-estado', 'preparacion');
          btnAceptar.disabled = false;
          btnAceptar.classList.add('en-preparacion');

          mostrarSelectorTiempo(false, minutosRestante);

          if (btnAjustar) {
            btnAjustar.setAttribute('data-codigo', pedido.codigo);
            btnAjustar.onclick = () => {
              mostrarSelectorTiempo(true, minutosRestante);
              btnAjustar.style.display = 'none';
              btnAceptar.textContent = 'Aceptar';
              btnAceptar.setAttribute('data-estado', 'pendiente');
              btnAceptar.classList.remove('en-preparacion');
              btnAceptar.disabled = false;
            };
          }

          if (btnImprimir) {
            btnImprimir.onclick = () => {
              const ticketWind = window.open('ticket', '_blank', 'width=400,height=700,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=no');
              ticketWind.onload = () => {
                // Mapea los productos igual que en el de listos
                const productosTicket = (pedido.pedido || []).map(item => ({
                  platillo: item.name || item.platillo || 'Producto',
                  cantidad: item.quantity || item.cantidad || 1,
                  subtotal: item.subtotal || item.total || 0,
                  opciones: item.opciones || item.specs || "",
                  complementos: item.complementos || []
                }));

                const tipoPedido = pedido.tipo || (
                  (pedido.domicilio || pedido.address) ? 'delivery' : 'pickup'
                );

                const pedidoParaTicket = {
                  idPedido: pedido.codigo,
                  nombre: pedido.nombre,
                  deliverTo: pedido.deliverTo || '',
                  celular: pedido.celular || pedido.numero,
                  domicilio: pedido.domicilio || pedido.address,
                  sucursal: pedido.sucursal,
                  metodoPago: pedido.metodoPago || pedido.payMethod,
                  total: pedido.total,
                  tipo: tipoPedido,
                  urgente: pedido.urgente,
                  instrucciones: pedido.instrucciones || pedido.specs,
                  pedido: productosTicket // <-- usa el array mapeado
                };

                ticketWind.postMessage({
                  type: 'PRINT_ORDER',
                  orderData: pedidoParaTicket,
                  autoPrint: true
                }, '*');
              };
            };
          }
        } else {
          btnAjustar && (btnAjustar.style.display = 'none');
          btnImprimir && (btnImprimir.style.display = 'none');

          if (estadoReal === 'pendiente') {
            tiempoActual = 15;
            btnAceptar.textContent = 'Aceptar';
            btnAceptar.setAttribute('data-estado', 'pendiente');
            btnAceptar.disabled = false;
            btnAceptar.classList.remove('en-preparacion');

            if (btnAjustar) btnAjustar.onclick = null;
            if (btnImprimir) btnImprimir.onclick = null;

            mostrarSelectorTiempo(true, tiempoActual);
          }
        }
      }

      mostrarPopupPedido(pedido);

      if (popupNormal) popupNormal.style.display = 'flex';

    } catch (err) {
      console.error("❌ Error al obtener pedido:", err);
      // Oculta ambos popups ante cualquier error
      if (popupNormal) popupNormal.style.display = 'none';
      if (popupListo) popupListo.style.display = 'none';
      showToastTopRight({
        message: 'Error al cargar el pedido, intente de nuevo.',
        background: '#ef4444',
        color: '#fff',
        duration: 3500
      })
    }
  });
}

function agregarStopPropagationPopupListo() {
  const popup = document.getElementById('pedidoPopupListo');
  if (!popup) return;

  const tarjeta = popup.querySelector('.popup-card-listo');
  if (!tarjeta) return;

  tarjeta.addEventListener('click', function (e) {
    e.stopPropagation();
  });
}

// OBTENER LA CANTIDAD TOTAL DE PRODUCTOS
function obtenerCantidadTotalProductos(pedido) {
  if (!Array.isArray(pedido.pedido)) return 0;
  return pedido.pedido.reduce((total, item) => total + (parseInt(item.quantity || item.cantidad || 1) || 0), 0);
}

function mostrarPopupPedidoListo(pedido) {
  ignoreNextPopupClose = true;
  setTimeout(() => {
    ignoreNextPopupClose = false;
  }, 300);

  const pedidoPopup = document.getElementById('pedidoPopup');
  if (pedidoPopup) pedidoPopup.style.display = 'none';
  const pedidoPopupListo = document.getElementById('pedidoPopupListo');
  if (pedidoPopupListo) pedidoPopupListo.style.display = 'flex';

  agregarStopPropagationPopupListo();

  // Título
  document.getElementById('popupTituloListo').textContent = `${pedido.nombre} • #${pedido.codigo}`;

  // Status y cliente
  const statusSpan = document.querySelector('#pedidoPopupListo .popup-status span');
  const totalArticulos = obtenerCantidadTotalProductos(pedido);
  if (statusSpan) statusSpan.textContent = `${totalArticulos} artículo${totalArticulos === 1 ? '' : 's'}`;
  document.getElementById('statusSucursalListo').textContent = `Sucursal: ${pedido.sucursal || "undefined"}`;

  // Limpia y rellena items
  const itemsContainer = document.querySelector('.popup-items-container-listo');
  itemsContainer.innerHTML = '';
  if (Array.isArray(pedido.pedido)) {
    pedido.pedido.forEach(item => {
      const nombre = item.platillo || item.name || 'Sin nombre';
      const cantidad = item.cantidad || item.quantity || 1;
      const precio = typeof item.subtotal !== 'undefined' && item.subtotal !== null
        ? item.subtotal
        : (typeof item.total !== 'undefined' && item.total !== null
            ? item.total
            : 0);

      const precioOriginal = item.precioOriginal || null;

      const div = document.createElement('div');
      div.className = 'popup-item';

      // Crear el encabezado del item
      const headerDiv = document.createElement('div');
      headerDiv.className = 'item-header';
      headerDiv.innerHTML = `
        <div>
          <div style="font-weight:bold;">${cantidad} × ${nombre}</div>
        </div>
        <div class="item-price">
          ${precioOriginal && precioOriginal != precio ? 
            `<div class="tachado">$${precioOriginal}</div>` : ''}
          <div class="precio">$${precio}</div>
        </div>
      `;
      div.appendChild(headerDiv);

      // Complementos si existen
      if (item.complementos && item.complementos.length > 0) {
        const complementosDiv = document.createElement('div');
        complementosDiv.className = 'item-details item-complementos';
        complementosDiv.innerHTML = `
          <div>Complementos:</div>
          <ul>
            ${item.complementos.map(c => `<li><span>${c}</span><span>$0.00</span></li>`).join('')}
          </ul>
        `;
        div.appendChild(complementosDiv);
      }

      itemsContainer.appendChild(div);
    });
  }

  // NUEVO: Agregar los comentarios del pedido (specs)
  if (pedido.specs && pedido.specs.trim() !== "") {
    const comentariosDiv = document.createElement('div');
    comentariosDiv.className = 'popup-comentarios-pedido';
    comentariosDiv.innerHTML = `<b>Comentarios:</b> ${pedido.specs}`;
    itemsContainer.appendChild(comentariosDiv);
  }

  if (pedido.domicilio || pedido.address) {
    const domicilioDiv = document.createElement('div');
    domicilioDiv.className = 'popup-domicilio';
    domicilioDiv.innerHTML = `
      <b>Domicilio:</b> ${pedido.domicilio || pedido.address || 'No especificado'}
    `;
    itemsContainer.appendChild(domicilioDiv);
  }

  if (pedido.deliverTo) {
    const deliverToDiv = document.createElement('div');
    deliverToDiv.className = 'popup-deliver-to';
    deliverToDiv.innerHTML = `
      <b>Entregar a:</b> ${pedido.deliverTo || 'No especificado'}
    `;
    itemsContainer.appendChild(deliverToDiv);
  }

  // Rellena totales
  let total = (typeof pedido.total === 'number')
    ? pedido.total
    : Array.isArray(pedido.pedido)
      ? pedido.pedido.reduce((sum, i) => sum + (parseFloat(i.subtotal || i.total) || 0), 0)
      : 0;
  document.querySelector('.popup-summary-listo').innerHTML = `
    <div class="linea">
      <span>Subtotal</span><span>$${total}</span>
    </div>
    <div class="linea total">
      <span>Total</span><span>$${total}</span>
    </div>
  `;

  // BOTÓN LIBERAR
  document.getElementById('btn-Liberar').onclick = async function() {
    const popup = document.getElementById('pedidoPopupListo');
    const codigo = popup.getAttribute('data-codigo') || pedido.codigo;
    if (!codigo) {
      alert('No se pudo identificar el pedido.');
      return;
    }

    actualizandoEstado = true;
    document.body.classList.add('cursor-bloqueado');

    try {
      // 1. Cambia el estado en Google Sheets
      const respSheets = await fetch('https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `action=actualizarEstadoPedido&codigo=${encodeURIComponent(codigo)}&nuevoEstado=Liberado`
      });
      const dataSheets = await respSheets.json();

      if (dataSheets.estado === "ESTADO_ACTUALIZADO") {
        // 2. Borra el pedido en el backend local
        const respDel = await fetch(`/api/pedidos/${codigo}`, { method: 'DELETE' });
        const dataDel = await respDel.json();

        if (dataDel.success) {
          renderPedidosListo();
          popup.style.display = 'none';
          showToast('¡Pedido con codigo <b>' + pedido.codigo + '</b> liberado correctamente!');
        } else {
          alert('No se pudo borrar el pedido localmente.');
        }
      } else {
        alert('No se pudo actualizar el estado en Google Sheets.');
      }
    } catch (e) {
      alert('Error al liberar el pedido: ' + (e.message || e));
    } finally {
      actualizandoEstado = false;
      document.body.classList.remove('cursor-bloqueado');
    }
  };

  // BOTÓN CANCELAR 
  document.getElementById('btn-Cancelar').onclick = function() {
    mostrarCancelarPedidoModal(pedido.codigo);
  };

  document.getElementById('cerrarPopupListo').onclick = function() {
    document.getElementById('pedidoPopupListo').style.display = 'none';
  };

  // Listener para imprimir (si quieres que funcione igual que en el popup normal)
  const btnImprimir = document.getElementById('btnImprimirPopupListo');
  if (btnImprimir) {
    btnImprimir.onclick = () => {
      const ticketWind = window.open('ticket', '_blank', 'width=400,height=700,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=no');
      ticketWind.onload = () => {
        // 1. Mapea los productos para el ticket
        const productosTicket = (pedido.pedido || []).map(item => ({
          platillo: item.name || item.platillo || 'Producto',
          cantidad: item.quantity || item.cantidad || 1,
          subtotal: item.subtotal || item.total || 0,
          opciones: item.opciones || item.specs || "",
          complementos: item.complementos || []
        }));

        const tipoPedido = pedido.tipo || (
          (pedido.domicilio || pedido.address) ? 'delivery' : 'pickup'
        );

        // 2. Usa el array mapeado aquí
        const pedidoParaTicket = {
          idPedido: pedido.codigo,
          nombre: pedido.nombre,
          deliverTo: pedido.deliverTo || '',
          celular: pedido.celular || pedido.numero,
          domicilio: pedido.domicilio || pedido.address,
          sucursal: pedido.sucursal,
          metodoPago: pedido.metodoPago || pedido.payMethod,
          total: pedido.total,
          tipo: tipoPedido,
          urgente: pedido.urgente,
          instrucciones: pedido.instrucciones || pedido.specs,
          pedido: productosTicket // <- aquí va el arreglo mapeado
        };

        ticketWind.postMessage({
          type: 'PRINT_ORDER',
          orderData: pedidoParaTicket,
          autoPrint: true
        }, '*');
      };
    };
  }
}

function mostrarCancelarPedidoModal(codigoPedido = '') {
  document.getElementById("cancelarPedidoOverlay").style.display = "flex";
  document.getElementById("motivoCancelacion").value = "";
  document.getElementById("estadoCancelarPedido").textContent = "";
  document.getElementById("cancelarPedidoOverlay").setAttribute("data-codigo", codigoPedido);
}

function cerrarCancelarPedidoModal() {
  document.getElementById("cancelarPedidoOverlay").style.display = "none";
}

document.getElementById("cerrarCancelarPedidoBtn").onclick = cerrarCancelarPedidoModal;
document.getElementById("cancelarCancelarPedidoBtn").onclick = cerrarCancelarPedidoModal;

document.addEventListener('keydown', function(e){ 
  const overlay = document.getElementById("cancelarPedidoOverlay");
  if (overlay || overlay.style.display !== 'flex') return;
  if (e.key === 'Escape') cerrarCancelarPedidoModal();
});

const WEBHOOK_URL = 'https://webhook.site/e6bd42b2-b1ad-49be-ae2b-cc246c974c56';
async function cancelarPedidoCompleto(codigoPedido, motivo) {
  try {
    const resp = await fetch('/api/cancelarPedido', {
      method: 'POST',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigoPedido, motivo })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || "Error al cancelar el pedido.");

    renderPedidosListo(); // Actualiza el panel de listos
    return true;
  } catch (err) {
    alert('Error al cancelar el pedido: ' + (err.message || err));
    return false;
  }
}

document.getElementById('formCancelarPedido').onsubmit = async function(e) {
  e.preventDefault();
  const motivo = document.querySelector('#cancelarPedidoOverlay #motivoCancelacion').value.trim();
  const codigoPedido = document.getElementById("cancelarPedidoOverlay").getAttribute("data-codigo");
  const estado = document.getElementById("estadoCancelarPedido");
  // const nombreCliente = document.getElementById()
  estado.textContent = "";

  if (!motivo) {
    estado.textContent = "Por favor, escribe el motivo de la cancelación.";
    estado.style.color = "var(--danger)";
    return;
  }

  estado.textContent = "Procesando...";
  estado.style.color = "var(--primary)";
  const exito = await cancelarPedidoCompleto(codigoPedido, motivo);

  if (exito) {
    estado.textContent = "Pedido cancelado correctamente.";
    estado.style.color = "var(--success)";
    setTimeout(() => cerrarCancelarPedidoModal(), 1200);
  } else {
    estado.textContent = "Error al cancelar el pedido.";
    estado.style.color = "var(--danger)";
  }
};

document.addEventListener('keydown', function(e) {
  // Si está abierto el popup de pedidos listos y se presiona ESC, ciérralo
  const popupListo = document.getElementById('pedidoPopupListo');
  if (!popupListo) return;
  if ((popupListo.style.display === 'flex' || popupListo.style.display === 'block') && e.key === 'Escape') {
    popupListo.style.display = 'none';
  }
});

document.addEventListener('click', function(e) {
  const popupListo = document.getElementById('pedidoPopupListo');
  if (!popupListo || popupListo.style.display !== 'flex') return;

  const clickedInside = popupListo.contains(e.target);

  // NO cerrar si recién se abrió o se clickeó dentro
  if (!clickedInside && !window._justOpenedListo) {
    popupListo.style.display = 'none';
  }
});

function mostrarPopupPedido(pedido) {
  // Título
  document.getElementById('popupTitulo').textContent = `${pedido.nombre} • #${pedido.codigo}`;

  // Estado, cliente, etc.
  const statusSpan = document.querySelector('.popup-status span');
  const totalArticulos = obtenerCantidadTotalProductos(pedido);
  if (statusSpan) statusSpan.textContent = `${totalArticulos} artículo${totalArticulos === 1 ? '' : 's'}`;
  document.getElementById('statusSucursal').textContent = `Sucursal: ${pedido.sucursal || "undefined"}`;

  // Elimina los .popup-item existentes
  document.querySelectorAll('.popup-item').forEach(el => el.remove());

  // Contenedor para los items
  let itemsContainer = document.querySelector('.popup-items-container');
  if (!itemsContainer) {
    itemsContainer = document.createElement('div');
    itemsContainer.className = 'popup-items-container';
    const popupBody = document.querySelector('.popup-body');
    const popupSummary = document.querySelector('.popup-summary');
    if (popupBody && popupSummary) {
      popupBody.insertBefore(itemsContainer, popupSummary);
    }
  } else {
    itemsContainer.innerHTML = '';
  }

  const audio = document.getElementById('newOrderSound');
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio.loop = false;
  }

  // Inserta los nuevos .popup-item
  if (Array.isArray(pedido.pedido)) {
    pedido.pedido.forEach(item => {
      const div = document.createElement('div');
      div.className = 'popup-item';

      const nombre = item.platillo || item.name || 'Sin nombre';
      const cantidad = item.cantidad || item.quantity || 1;
      const precio = item.subtotal || item.total || 0;

      const headerDiv = document.createElement('div');
      headerDiv.className = 'item-header';
      headerDiv.innerHTML = `
        <div>
          <div style="font-weight:bold;">${cantidad} × ${nombre}</div>
        </div>
        <div class="item-price">
          <div class="precio">$${precio}</div>
        </div>
      `;
      div.appendChild(headerDiv);

      // Opciones y complementos igual
      if (item.opciones || item.specs) {
        const opcionesDiv = document.createElement('div');
        opcionesDiv.className = 'item-details';
        opcionesDiv.innerHTML = `<div>Notas: ${item.opciones || item.specs}</div>`;
        div.appendChild(opcionesDiv);
      }
      if (item.complementos && item.complementos.length > 0) {
        const complementosDiv = document.createElement('div');
        complementosDiv.className = 'item-details item-complementos';
        complementosDiv.innerHTML = `
          <div>Complementos:</div>
          <ul>
            ${item.complementos.map(c => `<li><span>${c}</span><span>$0.00</span></li>`).join('')}
          </ul>
        `;
        div.appendChild(complementosDiv);
      }
      itemsContainer.appendChild(div);
    });
    if (pedido.domicilio || pedido.address) {
      const domicilioDiv = document.createElement('div');
      domicilioDiv.className = 'popup-domicilio';
      domicilioDiv.innerHTML = `
        <b>Domicilio:</b> ${pedido.domicilio || pedido.address || 'No especificado'}
      `;
      itemsContainer.appendChild(domicilioDiv);
    }

    if (pedido.deliverTo) {
      const deliverToDiv = document.createElement('div');
      deliverToDiv.className = 'popup-deliver-to';
      deliverToDiv.innerHTML = `
        <b>Entregar a:</b> ${pedido.deliverTo || 'No especificado'}
      `;
      itemsContainer.appendChild(deliverToDiv);
    }
  }

  // NUEVO: Agregar los comentarios del pedido (specs)
  if (pedido.specs && pedido.specs.trim() !== "") {
    const comentariosDiv = document.createElement('div');
    comentariosDiv.className = 'popup-comentarios-pedido';
    comentariosDiv.innerHTML = `<b>Comentarios:</b> ${pedido.specs}`;
    itemsContainer.appendChild(comentariosDiv);
  }

  // Calcular el total si no existe
  let total = pedido.total;
  if (typeof total === 'undefined') {
    total = Array.isArray(pedido.pedido)
      ? pedido.pedido.reduce((sum, item) => sum + (parseFloat(item.subtotal || item.total) || 0), 0)
      : 0;
  }

  // Ofertas y marketing (ejemplo, ajusta según tus datos)
  let oferta = pedido.oferta || 0;
  let marketing = pedido.marketing || 0;

  // Total
  const popupSummary = document.querySelector('.popup-summary');
  if (popupSummary) {
    popupSummary.innerHTML = `
      <div class="linea">
        <span>Subtotal</span><span>$${total + oferta}</span>
      </div>
      ${oferta ? `<div class="linea verde">
        <span>Oferta especial</span><span>($${oferta})</span>
      </div>` : ''}
      ${marketing ? `<div class="linea">
        <span>Marketing</span><span>$${marketing}</span>
      </div>` : ''}
      <div class="linea total">
        <span>Total</span><span>$${total}</span>
      </div>
    `;
  }

  // Mostrar el popup
  const pedidoPopup = document.getElementById('pedidoPopup');
  if (pedidoPopup) pedidoPopup.style.display = 'flex';
} 

function cargarPedidosEnPreparacion(sucursal) {
  // Solo traemos Pendiente y En preparacion
  const url = `https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec?action=getPedidos&sucursal=${encodeURIComponent(sucursal)}&estados=pendiente,en preparacion`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      data.pedidos.forEach(p => {
        if (typeof p.pedido === 'string') {
          try {
            p.pedido = JSON.parse(p.pedido);
          } catch (e) {
            p.pedido = [];
          }
        }
      });

      if (data.estado === "OK") {
        const pedidos = data.pedidos;
        const grid = document.getElementById("preparacionGrid");
        const empty = document.getElementById("preparacionEmpty");

        if (!grid || !empty) {
          console.warn("⚠️ Elementos no encontrados, creando...");
          createMissingElements();
          setTimeout(() => cargarPedidosEnPreparacion(sucursal), 100);
          return;
        }

        if (pedidos.length > pedidosPrevios.length) {
          const audio = document.getElementById("newOrderSound");
          audio?.play().catch(err => console.warn("⚠️ No se pudo reproducir el sonido:", err));
        }

        pedidosPrevios = pedidos;
        grid.querySelectorAll('.order-card').forEach(card => card.remove());
        iniciarCronometrosPedidosEnPreparacion();

        if (pedidos.length === 0) {
          empty.style.display = "flex";
        } else {
          empty.style.display = "none";
          pedidos.forEach(p => {
            const card = document.createElement("div");
            card.className = "order-card " + (p.estado === "Pendiente" ? "modern-green" : "preparacion");
            card.setAttribute('data-codigo', p.codigo || p.orderId); // sin #

            let cronometroHTML = "";
            if (p.estado === "En preparacion") {
              const inicio = parseInt(localStorage.getItem(`pedido_${p.codigo}_inicio`), 10);
              const minutos = parseInt(localStorage.getItem(`pedido_${p.codigo}_minutos`), 10) || 15;

              let minutosRestante = minutos;
              if (inicio) {
                const transcurrido = Math.floor((Date.now() - inicio) / 60000);
                minutosRestante = Math.max(minutos - transcurrido, 0)
              }

              cronometroHTML = `
                <div class="cronometro-top-right">
                  <span class="cronometro-label-mini">Listo en</span>
                  <span class="cronometro-tiempo-mini">${minutosRestante} min</span>
                </div>
              `;
            }

            card.innerHTML = `
              ${cronometroHTML}
              <div class="pedido-header">
                <div class="pedido-codigo">${p.codigo}</div>
                <div class="pedido-nombre">${p.nombre}</div>
                <div class="pedido-sucursal">${p.sucursal || 'Sucursal no especificada'}</div>
              </div>
              <div class="pedido-footer">
                <span class="ver-detalles" data-nombre="${p.nombre}" data-codigo="${p.codigo}">Ver detalles</span>
              </div>
            `;
            grid.appendChild(card);
          });
          actualizarContadorPreparacion(pedidos);
        }

        actualizarContadorPreparacion(pedidos);
      } else {
        console.warn("⚠️ Error en respuesta de pedidos:", data);
      }
    })
    .catch(err => {
      console.error("❌ Error al cargar pedidos:", err);
    });
}

function mostrarPopup(nombre, codigo) {
  const popupTitulo = document.getElementById('popupTitulo');
  if (popupTitulo) {
    popupTitulo.textContent = `${nombre} ${codigo}`;
  }
  tiempoActual = 0;
  actualizarTiempoDisplay();
  const popup = document.getElementById('pedidoPopup');
  // if (popup) popup.style.display = 'none';
  if (popup) {
    popup.style.display = 'flex';
  }
}

function actualizarTiempoDisplay() {
  const display = document.getElementById('tiempoDisplay');
  if (display) {
    display.textContent = `${tiempoActual} min`;
  }
}

// Inicializar la aplicación
initializeApp().catch(error => {
  console.error("❌ Error fatal en la inicialización:", error);
});

const ROL_USUARIO = localStorage.getItem('rol');
const SUCURSAL_USUARIO = localStorage.getItem('sucursal');
let nombreBienvenida;

if (ROL_USUARIO === 'admin' && SUCURSAL_USUARIO === 'ALL') {
  nombreBienvenida = 'Admin';
} else {
  nombreBienvenida = SUCURSAL_USUARIO || 'Sucursal no especificada';
}

if (localStorage.getItem('showWelcomeToast') === 'true') {
  showToastTopRight({
    message: `¡Bienvenido a Soru - ${nombreBienvenida}!`,
    duration: 4500,
    background: '#fff',
    color: '#2563eb'
  });
  localStorage.removeItem('showWelcomeToast');
}

function mostrarSelectorTiempo(mostrar, tiempo = 0) {
  const timeControls = document.querySelector('.time-controls');
  const btnAjustar = document.getElementById('btn-ajustar');
  if (mostrar) {
    // INICIALIZA la variable global con el valor mostrado
    tiempoActual = tiempo;
    if (timeControls) {
      timeControls.innerHTML = `
        <button id="decrementarTiempo">-</button>
        <span id="tiempoDisplay">${tiempoActual} min</span>
        <button id="incrementarTiempo">+</button>
      `;
      document.getElementById('incrementarTiempo').onclick = () => {
        if (tiempoActual < 55) {
          tiempoActual += 5;
          actualizarTiempoDisplay();
        }
      };
      document.getElementById('decrementarTiempo').onclick = () => {
        if (tiempoActual > 0) {
          tiempoActual -= 5;
          actualizarTiempoDisplay();
        }
      };
    }
    if (btnAjustar) btnAjustar.style.display = 'none';
  } else {
    if (timeControls) {
      timeControls.innerHTML = `<span class="tiempo-listo">${tiempoActual} min</span>`;
    }
    if (btnAjustar) btnAjustar.style.display = 'inline-flex';
  }
}

function mostrarTiempoSolo(tiempo) {
  const tiempoDisplay = document.getElementById('tiempoDisplay');
  if (tiempoDisplay) tiempoDisplay.textContent = `Listo en ${tiempo} min`;
}

function actualizarTiempoDisplay() {
  const display = document.getElementById('tiempoDisplay');
  if (display) {
    display.textContent = `${tiempoActual} min`;
  }
}


function mostrarTiempoSolo(tiempo) {
  const tiempoDisplay = document.getElementById('tiempoDisplay');
  if (tiempoDisplay) tiempoDisplay.textContent = `Listo en ${tiempo} min`;
}

function renderPedidosListo() {
  const listoGrid = document.getElementById('listoGrid');
  const listoEmpty = document.getElementById('listoEmpty');
  if (!listoGrid || !listoEmpty) {
    console.warn("No existe el grid o empty state de pedidos listos");
    return;
  }
  fetch('/api/pedidos.json')
    .then(res => res.json())
    .then(pedidos => {
      const pedidosListos = pedidos.filter(p => (p.estado || '').toLowerCase() === 'listo');
      listoGrid.querySelectorAll('.order-card').forEach(card => card.remove());

      if (pedidosListos.length === 0) {
        listoEmpty.style.display = 'flex';
      } else {
        listoEmpty.style.display = 'none';
        pedidosListos.forEach(p => {
          const card = document.createElement("div");
          card.className = 'order-card listo';
          card.setAttribute('data-codigo', p.codigo  || p.orderId);
          card.innerHTML = `
            <div class="pedido-header">
              <div class="pedido-codigo">${p.codigo}</div>
              <div class="pedido-nombre">${p.nombre}</div>
              <div class="pedido-sucursal">${p.sucursal || 'Sucursal no especificada'}</div>
            </div>
            <div class="pedido-footer">
              <span class="ver-detalles" data-codigo="${p.codigo}">Ver detalles</span>
            </div>
          `;
          listoGrid.appendChild(card);
        });
      }
    })
    .catch(err => {
      console.error("Error en renderPedidosListo:", err);
    });
}

function finalizarPedido(codigo) {
  fetch(`/api/pedidos/${codigo}`)
    .then(res => {
      if (!res.ok) throw new Error("Pedido no encontrado");
      return res.json();
    })
    .then(pedido => {
      // Actualizamos su estado a "Listo" en el cliente
      pedido.estado = 'Listo';

      // Mostramos en la interfaz
      renderPedidosListo();
      mostrarPopupPedido(pedido);
    })
    .catch(err => {
      console.error(`❌ No se pudo finalizar el pedido ${codigo}:`, err);
      alert('No se pudo finalizar el pedido.');
    });
}


function cambiarPedidoAListo(codigo, callback) {
  fetch(`/api/pedidos/${codigo}/estado`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'Listo' })
  })
  .then(res => res.json())
  .then(data => {
    if (!data.success) throw new Error('No se pudo actualizar el estado en el backend local.');
    return fetch('https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `action=actualizarEstadoPedido&codigo=${encodeURIComponent(codigo)}&nuevoEstado=Listo`
    }).then(res => res.json());
  })
  .then(dataSheet => {
    if (!dataSheet || dataSheet.estado !== 'ESTADO_ACTUALIZADO') {
      throw new Error('No se pudo actualizar el estado a Listo en Google Sheets.');
    }
    if (typeof callback === 'function') callback();
    cargarPedidosEnPreparacion(localStorage.getItem('rol') === 'admin' ? 'ALL' : localStorage.getItem('sucursal'));
    renderPedidosListo();
  })
  .catch(err => {
    alert(err.message || 'Error al cambiar el estado a Listo.');
  });
}

function iniciarCronometrosPedidosEnPreparacion() {
  if (window._timerPedidosPreparacion) clearInterval(window._timerPedidosPreparacion);

  window._timerPedidosPreparacion = setInterval(() => {
    pedidosPrevios.forEach(p => {
      if (normalizarEstado(p.estado) === 'en preparacion') {
        const inicio = parseInt(localStorage.getItem(`pedido_${p.codigo}_inicio`), 10);
        const minutos = parseInt(localStorage.getItem(`pedido_${p.codigo}_minutos`), 10) || 15;
        if (inicio) {
          const transcurrido = Math.floor((Date.now() - inicio) / 60000);
          const minutosRestante = Math.max(minutos - transcurrido, 0);

          // LOG para depuración
          // console.log(`[CRONO] Pedido: ${p.codigo}, minutosRestante: ${minutosRestante}`);

          if (minutosRestante <= 0) {
            console.log(`[CRONO] Pedido ${p.codigo} llegó a 0. Ejecutando cambio a Listo...`);
            cambiarPedidoAListo(p.codigo);
            localStorage.removeItem(`pedido_${p.codigo}_inicio`);
            localStorage.removeItem(`pedido_${p.codigo}_minutos`);
            localStorage.removeItem(`pedido_${p.codigo}_estado`);
          }
        }
      }
    });
  }, 20000);
}

// HISTORIAL
function cargarHistorialPedidos() {
  const historialGrid = document.getElementById('historialGrid');
  const historialEmpty = document.getElementById('historialEmpty');
  if (!historialGrid || !historialEmpty) return;

  historialGrid.querySelectorAll('.order-card').forEach(card => card.remove());

  fetch('https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec?action=getPedidos&sucursal=ALL&estados=liberado,cancelado')
    .then(res => res.json())
    .then(data => {
      // La respuesta es un objeto, NO un array
      const historialPedidos = (data.pedidos || []).filter(p => {
        const estado = (p.estado || "").toLowerCase();
        return estado === "liberado" || estado === "cancelado";
      });

      if (historialPedidos.length === 0) {
        historialEmpty.style.display = 'flex';
      } else {
        historialEmpty.style.display = 'none';
        historialPedidos.forEach(p => {
          const card = document.createElement("div");
          card.className = `order-card ${p.estado && p.estado.toLowerCase() === 'cancelado' ? 'danger' : ''}`;
          card.setAttribute('data-codigo', p.codigo || p.orderId);

          card.innerHTML = `
            <div class="pedido-header">
              <div class="pedido-codigo">${p.codigo}</div>
              <div class="pedido-nombre">${p.nombre}</div>
              <div class="pedido-sucursal">${p.sucursal || 'Sucursal no especificada'}</div>
            </div>
            <div class="pedido-footer">
              <span class="ver-detalles" data-codigo="${p.codigo}">Ver detalles</span>
            </div>
          `;
          historialGrid.appendChild(card);
        });
      }
    })
    .catch(err => {
      console.error("Error al cargar historial:", err);
      historialEmpty.style.display = 'flex';
    });
}

// HISTORIAL
function cargarHistorialPedidos() {
  const historialGrid = document.getElementById('historialGrid');
  const historialEmpty = document.getElementById('historialEmpty');
  if (!historialGrid || !historialEmpty) return;

  const sucursal = localStorage.getItem('sucursal');
  const rol = localStorage.getItem('rol');
  const sucursalParam = (rol === 'admin') ? 'ALL' : encodeURIComponent(sucursal);

  fetch(`https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec?action=getPedidos&sucursal=${sucursalParam}&estados=liberado,cancelado`, { cache: "no-store" })
    .then(res => res.json())
    .then(data => {
      const historialPedidos = (data.pedidos || []).filter(p => {
        // Filtro extra de seguridad
        if (rol !== 'admin' && (p.sucursal || '').toLowerCase() !== (sucursal || '').toLowerCase()) return false;
        const estado = (p.estado || "").toLowerCase();
        return estado === "liberado" || estado === "cancelado";
      });
      const codigosAgregados = new Set();
      const pedidosUnicos = historialPedidos.filter(p => {
        if (codigosAgregados.has(p.codigo)) return false;
        codigosAgregados.add(p.codigo);
        return true;
      });
      window._historialPedidos = pedidosUnicos;
      renderHistorialPedidos(pedidosUnicos);
    })
    .catch(err => {
      console.error("Error al cargar historial:", err);
      historialEmpty.style.display = 'flex';
    });
}

document.querySelector('[data-tab="historial"]').addEventListener('click', cargarHistorialPedidos);
document.getElementById('refreshHistorialBtn').addEventListener('click', cargarHistorialPedidos);

function renderHistorialPedidos(pedidos) {
  const historialGrid = document.getElementById('historialGrid');
  const historialEmpty = document.getElementById('historialEmpty');
  historialGrid.querySelectorAll('.order-card').forEach(card => card.remove());

  if (pedidos.length === 0) {
    historialEmpty.style.display = 'flex';
  } else {
    historialEmpty.style.display = 'none';
    pedidos.forEach(p => {
      let estadoLower = (p.estado || "").toLowerCase();
      let colorClass = estadoLower === "cancelado" ? "historial-cancelado" : "historial-liberado";
      const card = document.createElement("div");
      card.className = `order-card ${colorClass}`;
      card.setAttribute('data-codigo', p.codigo || p.orderId);
      card.setAttribute('data-historial', 'true');
      card.innerHTML = `
        <div class="pedido-header">
          <div class="pedido-codigo">${p.codigo}</div>
          <div class="pedido-nombre">${p.nombre}</div>
        </div>
        <div class="pedido-footer">
          <span class="estado-badge ${estadoLower}">${p.estado}</span>
        </div>
      `;
      historialGrid.appendChild(card);
    });
  }
}

document.getElementById('historialFilter').addEventListener('change', function() {
  const val = this.value.toLowerCase();
  let pedidosMostrados = window._historialPedidos || [];
  if (val === 'liberado') {
    pedidosMostrados = pedidosMostrados.filter(p => (p.estado || "").toLowerCase() === "liberado");
  } else if (val === 'cancelado') {
    pedidosMostrados = pedidosMostrados.filter(p => (p.estado || "").toLowerCase() === "cancelado");
  }
  // Si es "Todos" o vacío, no filtra nada
  renderHistorialPedidos(pedidosMostrados);
});

function actualizarContadorPreparacion(pedidos) {
  const pedidosEnPreparacion = pedidos.filter(p => 
    (p.estado || '').toLowerCase() === 'en preparacion'
  ).length;
  const contador = document.getElementById('contadorPreparacion');
  if (contador) contador.textContent = pedidosEnPreparacion;
}

const iconoSonido = document.getElementById('iconoSonido');

function actualizarIconoSonido() {
  if (sonidoActivo) {
    iconoSonido.src = 'Img/bell_on.svg';
    iconoSonido.title = 'Sonido activado';
  } else {
    iconoSonido.src = 'Img/bell_off.svg';
    iconoSonido.title = 'Activar sonido de pedidos';
  }
}

actualizarIconoSonido();

iconoSonido.addEventListener('click', function() {
  if (!sonidoActivo) {
    const audio = document.getElementById('newOrderSound');
    audio.play().then(() => {
      audio.pause();
      audio.currentTime = 0;
      sonidoActivo = true; // <--- Esto es importante
      localStorage.setItem('sonidoActivado', 'true');
      actualizarIconoSonido();
    }).catch(err => {
      alert('No se pudo activar el sonido: ' + err.message);
    });
  } else {
    sonidoActivo = false;
    localStorage.setItem('sonidoActivado', 'false');
    actualizarIconoSonido();
  }
});

const autoPrintSelect = document.getElementById('autoPrintEnabled');
if (autoPrintSelect) {
  autoPrintSelect.value = localStorage.getItem('autoPrintEnabled') || 'true';
  autoPrintSelect.addEventListener('change', function() {
    localStorage.setItem('autoPrintEnabled', this.value);
  })
}

async function obtenerPedidosParaEstadisticas() {
  try {
    const sucursal = localStorage.getItem('sucursal') || 'ALL';
    const res = await fetch(`/api/obtenerPedidos?sucursal=${sucursal}`);
    const data = await res.json();

    if (data.estado !== 'OK' || !Array.isArray(data.pedidos)) {
      setEstadisticasCero();
      throw new Error("No se pudo obtener pedidos");
    }

    const pedidos = data.pedidos;
    renderEstadisticas(pedidos); // Aquí haces el conteo de totales, etc.
  } catch (error) {
    console.error("❌ Error en estadísticas:", error);
    setEstadisticasCero();
  }
}

function renderEstadisticas(pedidos) {
  // FILTRO SOLO POR FECHA (día/mes/año, ignora hora)
  function esMismoDia(pedido) {
    // Obtiene la fecha del pedido
    const fecha = pedido.fecha || pedido.Fecha || pedido.date || pedido.Date;
    if (!fecha) return false;

    let pedidoDateObj;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) {
      // Formato dd/mm/yyyy
      const [dia, mes, anio] = fecha.split('/');
      pedidoDateObj = new Date(`${anio}-${mes}-${dia}`);
    } else if (/^\d{4}-\d{2}-\d{2}/.test(fecha)) {
      // Formato ISO o yyyy-mm-dd...
      pedidoDateObj = new Date(fecha);
    } else if (fecha.includes('T')) {
      // Formato ISO con hora
      pedidoDateObj = new Date(fecha);
    } else {
      return false;
    }

    if (isNaN(pedidoDateObj)) return false;

    // Obtiene la fecha actual (local)
    const ahora = new Date();
    // Para pruebas, puedes forzar la fecha:
    // const ahora = new Date("2025-08-01T03:00:00");

    return (
      pedidoDateObj.getFullYear() === ahora.getFullYear() &&
      pedidoDateObj.getMonth() === ahora.getMonth() &&
      pedidoDateObj.getDate() === ahora.getDate()
    );
  }

  // --- FILTRO FINAL SOLO POR FECHA ---
  const relevantes = pedidos.filter(p => {
    const estado = (p.estado || p.Estado || '').toLowerCase();
    return (estado === 'liberado' || estado === 'cancelado') && esMismoDia(p);
  });

  const completados = relevantes.filter(p => (p.estado || p.Estado || '').toLowerCase() === 'liberado');
  const cancelados = relevantes.filter(p => (p.estado || p.Estado || '').toLowerCase() === 'cancelado');

  const totalPedidos = relevantes.length;
  const pedidosCompletads = completados.length;
  const pedidosCancelados = cancelados.length;

  const tiempos = relevantes
    .map(p => parseInt(p.tiempo || p.Tiempo))
    .filter(t => !isNaN(t));
  const promedioTiempo = tiempos.length > 0
    ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length)
    : 0;

  // MÉTODOS DE PAGO SOLO EN RELEVANTES
  const efectivo = relevantes.filter(p => ((p.pago || p.Pago || '').toLowerCase() === 'efectivo')).length;
  const tarjetas = relevantes.filter(p => ((p.pago || p.Pago || '').toLowerCase() === 'tarjeta')).length;
  const transferencias = relevantes.filter(p => ((p.pago || p.Pago || '').toLowerCase() === 'transferencia')).length;

  document.getElementById("totalPedidos").textContent = totalPedidos;
  document.getElementById("completedPedidos").textContent = pedidosCompletads;
  document.getElementById("canceledPedidos").textContent = pedidosCancelados;
  document.getElementById("avgTime").textContent = promedioTiempo + ' min';
  document.getElementById("efectPedidos").textContent = efectivo;
  document.getElementById("cardPedidos").textContent = tarjetas;
  document.getElementById("transPedidos").textContent = transferencias;
}

function setEstadisticasCero() {
  console.log("⚠️ No se pudieron cargar estadísticas, estableciendo valores por defecto.");
  document.getElementById("totalPedidos").textContent = 0;
  document.getElementById("completedPedidos").textContent = 0;
  document.getElementById("canceledPedidos").textContent = 0;
  document.getElementById("avgTime").textContent = "—";
  document.getElementById("efectPedidos").textContent = 0;
  document.getElementById("cardPedidos").textContent = 0;
  document.getElementById("transPedidos").textContent = 0;
}

const btnCorte = document.getElementById('corte');
document.addEventListener('click', () => {
});

// CERRAR POPUP CORTE
const popupCorte = document.getElementById('popupCorte');
const corteContainer = popupCorte.querySelector('.corte-container');
const selectSucursal = document.getElementById('corteSucursalSelect');

popupCorte.addEventListener('click', (e) => {
  if (!corteContainer.contains(e.target)) {
    popupCorte.style.display = 'none';
    selectSucursal.value = '';
    document.getElementById('ventaEfectivo').textContent = '$0.00';
    document.getElementById('ventaTerminal').textContent = '$0.00';
    document.getElementById('ventaTotal').textContent = '$0.00';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && popupCorte.style.display === 'flex') {
    popupCorte.style.display = 'none';
    selectSucursal.value = '';
    document.getElementById('ventaEfectivo').textContent = '$0.00';
    document.getElementById('ventaTerminal').textContent = '$0.00';
    document.getElementById('ventaTotal').textContent = '$0.00';
  }
});

function mostrarPopupCorte() {
  const rol = localStorage.getItem('rol');
  const sucursalUsuario = localStorage.getItem('sucursal');
  const selectContainer = document.getElementById('corteSucursalSelectContainer');
  const selectSucursal = document.getElementById('corteSucursalSelect');
  const popupCorte = document.getElementById('popupCorte');

  if (rol === 'admin') {
    selectContainer.style.display = 'flex';
    cargarCorteSucursal(selectSucursal.value);
    selectSucursal.onchange = function() {
      cargarCorteSucursal(this.value);
    };
  } else {
    selectContainer.style.display = 'none';
    cargarCorteSucursal(sucursalUsuario);
  }
  popupCorte.style.display = 'flex';
}

function cargarCorteSucursal(sucursal) {
  // console.log("Cargar corte para:", sucursal);
  if (!sucursal) return;
  fetch(`/api/corte?sucursal=${encodeURIComponent(sucursal)}`)
    .then(res => res.json())
    .then(data => {
      // Backend responde: { efectivo, tarjeta, total }
      document.getElementById('ventaEfectivo').textContent = "$" + (data.efectivo ?? "undefined");
      document.getElementById('ventaTerminal').textContent = "$" + (data.tarjeta ?? "undefined");
      document.getElementById('ventaTotal').textContent = "$" + (data.total ?? "undefined");
    })
    .catch(() => {
      document.getElementById('ventaEfectivo').textContent = "$undefined";
      document.getElementById('ventaTerminal').textContent = "$undefined";
      document.getElementById('ventaTotal').textContent = "$undefined";
    });
}

if (btnCorte) {
  btnCorte.addEventListener('click', mostrarPopupCorte);
}

function abrirPopupEnviarCorte() {
  const rol = localStorage.getItem('rol');
  const sucursalUsuario = localStorage.getItem('sucursal');
  const selectSucursal = document.getElementById('corteSucursalSelect');
  const popupEnviarCorte = document.getElementById('popupEnviarCorreo');
  const popupCorte = document.getElementById('popupCorte');
  let sucursalSeleccionada = '';

  if (rol === 'admin') {
    sucursalSeleccionada = selectSucursal.value;
    if (!sucursalSeleccionada) {
      showToast('Por favor, selecciona una sucursal.');
      if (popupEnviarCorte) popupEnviarCorte.style.display = 'none';
      return;
    }
  } else {
    sucursalSeleccionada = sucursalUsuario;
    if (!sucursalSeleccionada) {
      showToast('No se pudo determinar la sucursal del usuario.');
      if (popupEnviarCorte) popupEnviarCorte.style.display = 'none';
      return;
    }
  }

  if (popupEnviarCorte) {
    popupEnviarCorte.style.display = 'flex';
    popupEnviarCorte.setAttribute('data-sucursal', sucursalSeleccionada);
    if (popupCorte) popupCorte.style.display = 'none'; // Cierra el popup de corte si está abierto
  }
}

// CERRAR POPUP ENVIAR CORREO
const popupEnviarCorreo = document.getElementById('popupEnviarCorreo');
const equisCerrarCorreo = document.getElementById('closePopupCorreo');
const contenidoPopup = document.querySelector('.modal-content-correo');

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && popupEnviarCorreo.style.display === 'flex') {
    popupEnviarCorreo.style.display = 'none';
  }
});

equisCerrarCorreo.addEventListener('click', (e) => {
  popupEnviarCorreo.style.display = 'none';
});

popupEnviarCorreo.addEventListener('click', (e) => {
  if (!contenidoPopup.contains(e.target)) {
    popupEnviarCorreo.style.display = 'none';
    // console.log('🔴 Cerrando popup de correo por clic fuera');
  }
});

function enviarCorteEmail() {
  const estadoCorreo = document.getElementById('estadoCorreo');
  const nombreDestinatario = document.getElementById('nameDestinatario').value.trim();
  const correoDestinatario = document.getElementById('mailDestinatario').value.trim();
  const sucursal = document.getElementById('popupEnviarCorreo').getAttribute('data-sucursal');
  estadoCorreo.textContent = '';

  // Validar que los campos no estén vacíos
  if (!nombreDestinatario || !correoDestinatario) {
    estadoCorreo.textContent = 'Por favor, complete los campos requeridos.';
    estadoCorreo.style.color = 'var(--danger)';
    estadoCorreo.timeout = setTimeout(() => {
      estadoCorreo.textContent = '';
    }, 3000);
  }

  fetch('/api/enviarCorte', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sucursal, nombreDestinatario, correoDestinatario })
  })
  .then(res => res.json())
  .then(data => {
    if (data.enviado) {
      estadoCorreo.textContent = 'Correo enviado exitosamente.';
      estadoCorreo.style.color = 'var(--success)';
      estadoCorreo.timeout = setTimeout(() => {
        popupEnviarCorreo.style.display = 'none';
        estadoCorreo.textContent = '';
      }, 3000);
    } else {
      estadoCorreo.textContent = 'Error al enviar el correo. Inténtalo de nuevo.';
      estadoCorreo.style.color = 'var(--danger)';
      estadoCorreo.timeout = setTimeout(() => {
        estadoCorreo.textContent = '';
      }, 3000);
    }
  })
}

// Modal about
const btnAbout = document.getElementById('about-btn');
const modalAbout = document.getElementById('aboutModal');
const aboutClose = document.getElementById('aboutClose');
const modalContent = document.querySelector('.modal');

btnAbout.addEventListener('click', () => {
  modalAbout.style.display = 'flex';
});

aboutClose.addEventListener('click', () => {
  modalAbout.style.display = 'none';
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalAbout.style.display === 'flex') {
    modalAbout.style.display = 'none';
  }
});

modalAbout.addEventListener('click', (e) => {
  if (!modalContent.contains(e.target)) {
    modalAbout.style.display = 'none';
  }
});


// Ejemplo: Llama esta función cuando abras el panel admin o cada vez que quieras refrescar estadísticas
// actualizarEstadisticasAdmin();