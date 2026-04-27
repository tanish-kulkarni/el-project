// ===== USER =====



const token = sessionStorage.getItem("token");     //new
const user  = JSON.parse(sessionStorage.getItem("user") || "null");  //new




if (!token || !user) {          //new



  window.location = "index.html";
}

// ===== DISPLAY ROLE =====
document.getElementById("role").innerText = user.role;

// ===== SHOW ADMIN PANEL =====
if (user.role === "ADMIN") {
  document.getElementById("adminPanel").style.display = "block";
}

// ===== LOGOUT =====
function logout() {


  sessionStorage.removeItem("token");     //new
  sessionStorage.removeItem("user");      //new
  
  
  window.location = "index.html";
}



//new
// ===== AUTH HEADERS ===== 
function authHeaders() {
  return {
    "Authorization": token,
    "Content-Type": "application/json"
  };
}       //new





// ===== UPLOAD =====
async function upload() {
  const file = document.getElementById("file").files[0];

  if (!file) {
    alert("Select a file first");
    return;
  }

  const fd = new FormData();
  fd.append("file", file);

  await fetch("/upload", {
    method: "POST",


    headers: { "Authorization": token },    //new
    
    
    body: fd
  });

  loadDocs();
}

// ===== LOAD DOCUMENTS =====
async function loadDocs() {
  const list = document.getElementById("list");
  list.innerHTML = "<p>Loading...</p>";

  const res = await fetch("/documents", { headers: authHeaders() });    //new

 
  
 
  if (res.status === 401) {       //new
    alert("Session expired. Please log in again.");
    logout();
    return;
  }           //new




  const docs = await res.json();

  list.innerHTML = "";

  if (docs.length === 0) {
    list.innerHTML = "<p style='color:#94a3b8;'>No documents yet</p>";
    return;
  }

  docs.forEach(doc => {
    const div = document.createElement("div");
    div.className = "doc-card";

    let approveBtn = "";

    if (doc.flow[doc.currentStep] === user.role) {
      approveBtn = `<button onclick="approve(${doc.id})">Approve</button>`;
    }

    div.innerHTML = `
      <h4>${doc.name}</h4>
      <p>Status: ${doc.status}</p>
      <p>Current: ${doc.flow[doc.currentStep] || "Done"}</p>
      <p class="flow">${doc.flow.join(" → ")}</p>
      ${approveBtn}
    `;

    list.appendChild(div);
  });
}

// ===== APPROVE =====
async function approve(id) {
  await fetch("/approve", {
    method: "POST",


    headers: authHeaders(),       //new
    
    
    body: JSON.stringify({ id, role: user.role })
  });

  loadDocs();
}

// ===== CREATE WORKFLOW =====
async function createWorkflow() {
  const type = document.getElementById("type").value;
  const flow = document.getElementById("flow").value.split(",");

  if (!type || flow.length === 0) {
    alert("Enter valid workflow");
    return;
  }

  await fetch("/create-workflow", {
    method: "POST",


    headers: authHeaders(),        //new
    
    
    body: JSON.stringify({ type, flow })
  });

  alert("Workflow created");
}

// ===== INITIAL LOAD =====
loadDocs();