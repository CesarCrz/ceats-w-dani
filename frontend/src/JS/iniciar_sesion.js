document.getElementById("loginBtn").addEventListener("click", login);

['email', 'password'].forEach(id => {
  const  input = document.getElementById(id);
  if (input) {
    input.addEventListener('keydown', function(e){
      if (e.key === 'Enter') {
        login();
      }
    });
  }
});

function login() {
  const email = document.getElementById("email").value.trim().toLowerCase();
  const password = document.getElementById("password").value.trim();
  const loader = document.getElementById('loginLoader');

  if (!email || !password) {
    showLoginError("Por favor, completa todos los campos.");
    return;
  }

  if (loader) loader.style.display = 'flex';
  document.getElementById('loginBtn').disabled = true;

  // Parámetros tipo formulario
  const params = new URLSearchParams();
  // params.append("rest", "(restaurante al que se conecta)");
  params.append("action", "login");
  params.append("email", email);
  params.append("password", password);

  console.log("📤 Enviando a Apps Script:", {
    action: "login",
    email: email,
    password: "********" // ocultamos en consola por seguridad
  });

  fetch("https://script.google.com/macros/s/AKfycbzhwNTB1cK11Y3Wm7uiuVrzNmu1HD1IlDTPlAJ37oUDgPIabCWbZqMZr-86mnUDK_JPBA/exec", {
    method: "POST",
    body: params // ✅ sin headers para evitar CORS
  })
  .then(res => {
    console.log("📥 Respuesta cruda:", res);
    return res.json();
  })
  .then(data => {
    console.log("📥 Respuesta procesada:", data);
    if (loader) loader.style.display = 'none';
    document.getElementById("loginBtn").disabled = false;

    if (data.estado === "VALIDO") {
      localStorage.setItem("email", email);
      localStorage.setItem("rol", data.rol);
      localStorage.setItem("sucursal", data.sucursal);
      localStorage.setItem('showWelcomeToast', 'true');
      console.log("✅ Login correcto, redirigiendo a main...");
      window.location.href = "main";
    } else if (data.estado === "PASS_INVALIDA") {
      showLoginError("Contraseña incorrecta.");
    } else if (data.estado === "NO_EXISTE_USUARIO") {
      showLoginError("Usuario no encontrado.");
    } else {
      showLoginError("Error desconocido. Por favor, intenta de nuevo.");
    }
  })
  .catch(error => {
    if (loader) loader.style.display = 'none';
    document.getElementById("loginBtn").disabled = false;
    console.error("❌ Error de red o servidor:", error);
    showLoginError('Ocurrió un error al iniciar sesión. Por favor, intenta de nuevo más tarde.');
  });
}

function showLoginError(msg) {
  const errorDiv = document.getElementById('loginError');

  if (errorDiv) {
    errorDiv.textContent = msg;
    errorDiv.style.display = 'block';
    
    setTimeout(() => {
      errorDiv.style.display = 'none';
    }, 4000);
  }
}