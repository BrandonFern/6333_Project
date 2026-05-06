/**
 * SmartLab — app.js
 */
'use strict';

/* ═══════════════════════════════════════════════
   1. API CLIENT
════════════════════════════════════════════════ */

const API_BASE = '/api';

async function apiGet(path) {
  const res = await fetch(API_BASE + path, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) await handleApiError(res);
  return res.json();
}

async function apiSend(method, path, body = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content ?? ''
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) await handleApiError(res);
  return res.json();
}

async function handleApiError(res) {
  let msg = `Request failed (${res.status})`;
  try {
    const data = await res.json();
    if (data.error) msg = data.error;
  } catch (_) {}
  showToast('Error', msg);
  throw new Error(msg);
}

/* ═══════════════════════════════════════════════
   2. AUTH
════════════════════════════════════════════════ */

let session     = null;
let _equipCache = {};   // equipment_id → row — used to pre-fill the edit modal
let _userCache  = {};   // user_id      → row — used to pre-fill the edit modal

document.getElementById('loginBtn')?.addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPwd').value;

  if (!email || !password) {
    document.getElementById('loginErr').style.display = 'block';
    return;
  }

  try {
    session = await apiSend('POST', '/auth/login', { email, password });

    document.getElementById('loginErr').style.display = 'none';
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('appShell').style.display = 'flex';
    initApp();
  } catch (_) {
    document.getElementById('loginErr').style.display = 'block';
  }
});

document.getElementById('logoutBtn')?.addEventListener('click', doLogout);
document.getElementById('topLogoutBtn')?.addEventListener('click', doLogout);
document.getElementById('showRegisterBtn')?.addEventListener('click', async () => {
  await loadRegisterDepartments();
  openModal('registerModal');
});

async function doLogout() {
  try {
  await apiSend('POST', '/auth/logout');
  session = null;
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPwd').value = '';
  window.location.reload();
  }catch (err) {
    console.error('Logout failed:', err);
  }
}

/* ═══════════════════════════════════════════════
   3. APP INIT
════════════════════════════════════════════════ */

const ROLE_LABELS = {
  admin: 'Administrator',
  professor: 'Professor',
  lab_manager: 'Lab Manager',
  student: 'Student'
};

const ROLE_BADGE_CLASS = {
  admin: 'b-admin',
  professor: 'b-professor',
  lab_manager: 'b-labmanager',
  student: 'b-student'
};

function initApp() {
  document.getElementById('sideName').textContent = `${session.first_name} ${session.last_name}`;
  document.getElementById('sideRole').textContent = ROLE_LABELS[session.role];
  document.getElementById('sideAvatar').textContent = (session.first_name[0] + session.last_name[0]).toUpperCase();

  const tag = document.getElementById('roleTag');
  tag.className = 'badge ' + (ROLE_BADGE_CLASS[session.role] ?? 'b-student');
  tag.textContent = session.role.replace('_', ' ');

  const showAdmin = session.role === 'admin' || session.role === 'lab_manager';
  document.getElementById('adminNav').style.display = showAdmin ? 'block' : 'none';

  const isAdmin = session.role === 'admin';
  document.getElementById('addEquipBtn').style.display = isAdmin ? 'inline-flex' : 'none';
  document.getElementById('grantCertBtn').style.display = isAdmin ? 'inline-flex' : 'none';

  loadSetupDropdowns();
  loadDynamicModalDropdowns();
  loadDashboard();

  document.getElementById('equipSearch')?.addEventListener('keyup', loadEquipment);
  document.getElementById('filterType')?.addEventListener('change', loadEquipment);
  document.getElementById('filterBuilding')?.addEventListener('change', loadEquipment);

  document.getElementById('resSearch')?.addEventListener('keyup', loadReservations);
  document.getElementById('filterResStatus')?.addEventListener('change', loadReservations);

  document.getElementById('maintSearch')?.addEventListener('keyup', loadMaintenance);
  document.getElementById('filterMaintStatus')?.addEventListener('change', loadMaintenance);

  document.getElementById('certSearch')?.addEventListener('keyup', loadCertifications);

  document.getElementById('userSearch')?.addEventListener('keyup', loadUsers);
  document.getElementById('filterUserRole')?.addEventListener('change', loadUsers);
}

/* ═══════════════════════════════════════════════
   4. PAGE NAVIGATION
════════════════════════════════════════════════ */

const PAGE_META = {
  dashboard: ['Dashboard', 'Overview'],
  equipment: ['Equipment', 'Browse & Search'],
  reservations: ['Reservations', 'Schedule'],
  maintenance: ['Maintenance', 'Issue Tracking'],
  certifications: ['Certifications', 'Training'],
  users: ['All Users', 'Admin'],
  analytics: ['Analytics', 'Reporting'],
};

document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => showPage(item.dataset.page, item));
});

function showPage(id, navEl) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  if (navEl) navEl.classList.add('active');

  const [title, crumb] = PAGE_META[id] ?? [id, ''];
  document.getElementById('topTitle').textContent = title;
  document.getElementById('topCrumb').textContent = crumb;

  const loaders = {
    dashboard: loadDashboard,
    equipment: loadEquipment,
    reservations: loadReservations,
    maintenance: loadMaintenance,
    certifications: loadCertifications,
    users: loadUsers,
    analytics: loadAnalytics,
  };

  if (loaders[id]) loaders[id]();
}

/* ═══════════════════════════════════════════════
   5. SETUP DROPDOWNS
════════════════════════════════════════════════ */

async function loadSetupDropdowns() {
  try {
    const [types, buildings, depts] = await Promise.all([
      apiGet('/equipment-types'),
      apiGet('/buildings'),
      apiGet('/departments')
    ]);

    const typeSel = document.getElementById('filterType');
    if (typeSel) {
      typeSel.innerHTML = '<option value="">All Types</option>';
      types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.equipment_type_id;
        opt.textContent = t.type_name;
        typeSel.appendChild(opt);
      });
    }

    const buildingSel = document.getElementById('filterBuilding');
    if (buildingSel) {
      buildingSel.innerHTML = '<option value="">All Buildings</option>';
      buildings.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.building_id;
        opt.textContent = b.building_name;
        buildingSel.appendChild(opt);
      });
    }

    const regDept = document.getElementById('regDept');
    if (regDept) {
      regDept.innerHTML = '<option value="">-- select --</option>';
      depts.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.department_id;
        opt.textContent = d.department_name;
        regDept.appendChild(opt);
      });
    }

    const utilDept = document.getElementById('utilDept');
    if (utilDept) {
      utilDept.innerHTML = '<option value="">All Departments</option>';
      depts.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.department_id;
        opt.textContent = d.department_name;
        utilDept.appendChild(opt);
      });
    }

    const equipType = document.getElementById('equipType');
    if (equipType) {
      equipType.innerHTML = '<option value="">-- select --</option>';
      types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.equipment_type_id;
        opt.textContent = t.type_name;
        equipType.appendChild(opt);
      });
    }

    const equipBuilding = document.getElementById('equipBuilding');
    if (equipBuilding) {
      equipBuilding.innerHTML = '<option value="">-- select --</option>';
      buildings.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.building_id;
        opt.textContent = b.building_name;
        equipBuilding.appendChild(opt);
      });
    }

    const certType = document.getElementById('certType');
    if (certType) {
      certType.innerHTML = '<option value="">-- select --</option>';
      types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.equipment_type_id;
        opt.textContent = t.type_name;
        certType.appendChild(opt);
      });
    }

    // Edit Equipment modal dropdowns
    const editEquipType = document.getElementById('editEquipType');
    if (editEquipType) {
      editEquipType.innerHTML = '<option value="">-- select type --</option>';
      types.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.equipment_type_id;
        opt.textContent = t.type_name;
        editEquipType.appendChild(opt);
      });
    }

    const editEquipBuilding = document.getElementById('editEquipBuilding');
    if (editEquipBuilding) {
      editEquipBuilding.innerHTML = '<option value="">-- select building --</option>';
      buildings.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.building_id;
        opt.textContent = b.building_name;
        editEquipBuilding.appendChild(opt);
      });
    }

    // Edit User modal department dropdown
    const editUserDept = document.getElementById('editUserDept');
    if (editUserDept) {
      editUserDept.innerHTML = '<option value="">-- none --</option>';
      depts.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.department_id;
        opt.textContent = d.department_name;
        editUserDept.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Could not load setup dropdowns:', err);
  }
}

async function loadDynamicModalDropdowns() {
  try {
    const equip = await apiGet('/equipment');
    const resEquip = document.getElementById('resEquip');
    const issueEquip = document.getElementById('issueEquip');

    if (resEquip) {
      resEquip.innerHTML = '<option value="">-- select equipment --</option>' +
        equip.filter(e => e.status === 'available')
             .map(e => `<option value="${e.equipment_id}">${e.equipment_name} (${e.serial_number})</option>`).join('');
    }
    if (issueEquip) {
      issueEquip.innerHTML = '<option value="">-- select equipment --</option>' +
        equip.map(e => `<option value="${e.equipment_id}">${e.equipment_name} (${e.serial_number})</option>`).join('');
    }

    if (session?.role === 'admin') {
      const users = await apiGet('/users');
      const certUser = document.getElementById('certUser');
      if (certUser) {
        certUser.innerHTML = '<option value="">-- select user --</option>' +
          users.map(u => `<option value="${u.user_id}">${u.first_name} ${u.last_name}</option>`).join('');
      }
    }
  } catch (err) {
    console.error('Could not load modal dropdowns:', err);
  }
}

async function loadAnalyticsDropdowns() {
  try {
    const [depts, buildings] = await Promise.all([
      apiGet('/departments'),
      apiGet('/buildings')
    ]);

    const deptSel = document.getElementById('utilDept');
    if (deptSel) {
      deptSel.innerHTML = '<option value="">All Departments</option>';
      depts.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.department_id;
        opt.textContent = d.department_name;
        deptSel.appendChild(opt);
      });
    }

    const bldSel = document.getElementById('utilBuilding');
    if (bldSel) {
      bldSel.innerHTML = '<option value="">All Buildings</option>';
      buildings.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.building_id;
        opt.textContent = b.building_name;
        bldSel.appendChild(opt);
      });
    }
  } catch (_) {}
}

async function loadRegisterDepartments() {
  try {
    const depts = await apiGet('/departments');
    const regDept = document.getElementById('regDept');

    if (regDept) {
      regDept.innerHTML = '<option value="">-- select --</option>';
      depts.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.department_id;
        opt.textContent = d.department_name;
        regDept.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Could not load register departments:', err);
  }
}

/* ═══════════════════════════════════════════════
   6. DATA LOADERS
════════════════════════════════════════════════ */

async function loadDashboard() {
  try {
    const data = await apiGet('/dashboard');
    document.getElementById('statTotal').textContent = data.stats.total ?? '--';
    document.getElementById('statAvailable').textContent = data.stats.available ?? '--';
    document.getElementById('statReservations').textContent = data.reservations.length;
    document.getElementById('statIssues').textContent = data.stats.open_issues ?? '--';

    renderDashboardReservations(data.reservations);
    renderExpiringCerts(data.expiring_certifications);
  } catch (_) {}
}

function renderDashboardReservations(rows) {
  const tbody = document.getElementById('dashReservationsTbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty">
      <div class="empty-title">No upcoming reservations</div>
    </div></td></tr>`;
    return;
  }

  // FIX: Added 'Start', 'Complete', and 'Cancel' logic mapped to status
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escHtml(r.equipment_name)}</td>
      <td>${formatDatetime(r.start_time)}</td>
      <td>${formatDatetime(r.end_time)}</td>
      <td><span class="badge b-${r.status}">${r.status}</span></td>
      <td>
        ${r.status === 'approved' ? `
          <button class="btn btn-success btn-sm" onclick="updateResStatus(${r.reservation_id}, 'active')">Start</button>` : ''}
        ${r.status === 'active' ? `
          <button class="btn btn-secondary btn-sm" onclick="updateResStatus(${r.reservation_id}, 'completed')">Complete</button>` : ''}
        ${['pending','approved'].includes(r.status) ? `
          <button class="btn btn-danger btn-sm" onclick="updateResStatus(${r.reservation_id}, 'canceled')">Cancel</button>` : ''}
      </td>
    </tr>`).join('');
}

function renderExpiringCerts(rows) {
  const el = document.getElementById('dashCertsList');
  if (!rows.length) {
    el.innerHTML = `<div class="empty">
      <div class="empty-title">No expiring certifications</div>
    </div>`;
    return;
  }

  el.innerHTML = rows.map(c => {
    const days = Math.ceil((new Date(c.expiration_date) - Date.now()) / 86400000);
    const cls = days < 14 ? 'b-expired' : 'b-expiring';
    return `<div style="padding:10px 18px;border-bottom:1px solid var(--border);font-size:0.75rem;">
      <strong>${escHtml(c.type_name)}</strong>
      &nbsp;<span class="badge ${cls}">${days} days</span>
      <div style="font-family:var(--mono);font-size:0.62rem;color:var(--ink3);margin-top:2px;">
        Expires ${c.expiration_date}
      </div>
    </div>`;
  }).join('');
}

async function loadEquipment() {
  try {
    const params = new URLSearchParams();
    const typeId = document.getElementById('filterType')?.value;
    const buildingId = document.getElementById('filterBuilding')?.value;
    const searchVal = document.getElementById('equipSearch')?.value.trim();

    if (typeId) params.set('type_id', typeId);
    if (buildingId) params.set('building_id', buildingId);
    if (searchVal) params.set('q', searchVal);

    const rows = await apiGet(`/equipment?${params}`);
    const tbody = document.getElementById('equipTbody');

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty">
        <div class="empty-title">No equipment found</div>
      </div></td></tr>`;
      return;
    }

    rows.forEach(e => { _equipCache[e.equipment_id] = e; });

    tbody.innerHTML = rows.map(e => `
      <tr>
        <td class="db-cell">#${e.equipment_id}</td>
        <td>${escHtml(e.equipment_name)}</td>
        <td style="font-family:var(--mono);font-size:0.7rem;">${escHtml(e.serial_number)}</td>
        <td>${escHtml(e.type_name)}</td>
        <td>${escHtml(e.building_name)}</td>
        <td><span class="badge b-${e.status}">${e.status}</span></td>
        <td style="font-family:var(--mono);font-size:0.7rem;">${e.purchase_date ?? '--'}</td>
        <td>
          ${e.status === 'available'
            ? `<button class="btn btn-primary btn-sm" onclick="reserveEquipment(${e.equipment_id})">Reserve</button>`
            : ''}
          <button class="btn btn-secondary btn-sm"
                  onclick="loadEquipmentHistory(${e.equipment_id})">History</button>
          <button class="btn btn-danger btn-sm" onclick="openModal('issueModal')">Issue</button>
          ${session?.role === 'admin' ? `
            <button class="btn btn-secondary btn-sm"
                    onclick="openEditEquipModal(${e.equipment_id})">Edit</button>
            ${e.status !== 'retired' ? `
            <button class="btn btn-danger btn-sm"
                    onclick="retireEquipment(${e.equipment_id})">Retire</button>` : ''}` : ''}
        </td>
      </tr>`).join('');
  } catch (_) {}
}

async function loadEquipmentHistory(equipmentId) {
  try {
    const rows = await apiGet(`/equipment/${equipmentId}/history`);
    const panel = document.getElementById('equipHistoryPanel');
    panel.querySelector('.empty')?.remove();

    const tbody = panel.querySelector('tbody') ??
      (() => {
        panel.innerHTML += `<div class="tbl-wrap"><table>
          <thead><tr><th>Type</th><th>Date</th><th>User / Note</th></tr></thead>
          <tbody id="historyTbody"></tbody></table></div>`;
        return panel.querySelector('tbody');
      })();

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td><span class="badge ${r.event_type === 'reservation' ? 'b-active' : 'b-maintenance'}">
          ${r.event_type}</span></td>
        <td style="font-family:var(--mono);font-size:0.7rem;">${formatDatetime(r.event_date)}</td>
        <td>${escHtml(String(r.user_id ?? ''))}</td>
      </tr>`).join('');
  } catch (_) {}
}

async function loadReservations() {
  try {
    const params = new URLSearchParams();
    const statusVal = document.getElementById('filterResStatus')?.value;
    const searchVal = document.getElementById('resSearch')?.value.trim();

    if (statusVal) params.set('status', statusVal);
    if (searchVal) params.set('q', searchVal);

    const rows = await apiGet(`/reservations?${params}`);
    const tbody = document.getElementById('resTbody');

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty">
        <div class="empty-title">No reservations found</div>
      </div></td></tr>`;
      return;
    }

    // FIX: Added 'Start' and 'Complete' buttons for the lifecycle
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td class="db-cell">#${r.reservation_id}</td>
        <td>${escHtml(r.user_name)}</td>
        <td>${escHtml(r.equipment_name)}</td>
        <td style="font-family:var(--mono);font-size:0.7rem;">${formatDatetime(r.start_time)}</td>
        <td style="font-family:var(--mono);font-size:0.7rem;">${formatDatetime(r.end_time)}</td>
        <td><span class="badge b-${r.status}">${r.status}</span></td>
        <td style="font-family:var(--mono);font-size:0.7rem;">${formatDatetime(r.created_at)}</td>
        <td>
          ${r.status === 'pending' && ['admin', 'lab_manager'].includes(session?.role) ? `
            <button class="btn btn-primary btn-sm"
                    onclick="updateResStatus(${r.reservation_id}, 'approved')">Approve</button>` : ''}
          ${r.status === 'approved' ? `
            <button class="btn btn-success btn-sm"
                    onclick="updateResStatus(${r.reservation_id}, 'active')">Start</button>` : ''}
          ${r.status === 'active' ? `
            <button class="btn btn-secondary btn-sm"
                    onclick="updateResStatus(${r.reservation_id}, 'completed')">Complete</button>` : ''}
          ${['pending','approved'].includes(r.status) ? `
            <button class="btn btn-danger btn-sm"
                    onclick="updateResStatus(${r.reservation_id}, 'canceled')">Cancel</button>` : ''}
        </td>
      </tr>`).join('');
  } catch (_) {}
}

async function loadMaintenance() {
  try {
    const params = new URLSearchParams();
    const statusVal = document.getElementById('filterMaintStatus')?.value;
    const searchVal = document.getElementById('maintSearch')?.value.trim();

    if (statusVal) params.set('status', statusVal);
    if (searchVal) params.set('q', searchVal);

    const rows = await apiGet(`/maintenance?${params}`);
    const tbody = document.getElementById('maintTbody');

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty">
        <div class="empty-title">No maintenance records</div>
      </div></td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(m => `
      <tr>
        <td class="db-cell">#${m.maintenance_id}</td>
        <td>${escHtml(m.equipment_name)}</td>
        <td>${escHtml(m.reported_by_name)}</td>
        <td>${escHtml(m.issue_description)}</td>
        <td style="font-family:var(--mono);font-size:0.7rem;">${formatDatetime(m.reported_date)}</td>
        <td style="font-family:var(--mono);font-size:0.7rem;">${m.resolved_date ? formatDatetime(m.resolved_date) : '--'}</td>
        <td><span class="badge b-${String(m.status).replace('_','')}">${m.status}</span></td>
        <td>
          ${m.status !== 'resolved' && session?.role === 'admin' ? `
            <button class="btn btn-primary btn-sm"
                    onclick="resolveMaintenance(${m.maintenance_id})">Resolve</button>` : ''}
        </td>
      </tr>`).join('');
  } catch (_) {}
}

async function loadCertifications() {
  try {
    const params = new URLSearchParams();
    const searchVal = document.getElementById('certSearch')?.value.trim();
    if (searchVal) params.set('q', searchVal);

    const rows  = await apiGet(`/certifications?${params}`);
    const tbody = document.getElementById('certTbody');
    const isAdmin = session?.role === 'admin';

    // Update table header dynamically based on role
    const thead = tbody?.closest('table')?.querySelector('thead tr');
    if (thead) {
      thead.innerHTML = isAdmin
        ? `<th>User</th><th>Equipment Type</th><th>Issued</th><th>Expires</th><th>Days Remaining</th><th>Status</th><th>Actions</th>`
        : `<th>Equipment Type</th><th>Issued</th><th>Expires</th><th>Days Remaining</th><th>Status</th>`;
    }

    const cols = isAdmin ? 7 : 5;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${cols}"><div class="empty">
        <div class="empty-title">No certifications on record</div>
      </div></td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(c => {
      const days = Math.ceil((new Date(c.expiration_date) - Date.now()) / 86400000);
      const cls = days < 0 ? 'b-expired' : days < 30 ? 'b-expiring' : 'b-valid';
      const statusLabel = days < 0 ? 'expired' : days < 30 ? 'expiring' : 'valid';
      return `<tr>
        ${isAdmin ? `<td>${escHtml(c.user_name ?? '--')}</td>` : ''}
        <td>${escHtml(c.type_name)}</td>
        <td style="font-family:var(--mono);font-size:0.7rem;">${c.certification_date}</td>
        <td style="font-family:var(--mono);font-size:0.7rem;">${c.expiration_date}</td>
        <td style="font-family:var(--mono);font-weight:600;">${days} days</td>
        <td><span class="badge ${cls}">${statusLabel}</span></td>
        ${isAdmin ? `<td>
          <button class="btn btn-danger btn-sm"
                  onclick="deleteCert(${c.certification_id})">Delete</button>
        </td>` : ''}
      </tr>`;
    }).join('');
  } catch (_) {}
}

async function loadUsers() {
  try {
    const params = new URLSearchParams();
    const roleVal = document.getElementById('filterUserRole')?.value;
    const searchVal = document.getElementById('userSearch')?.value.trim();

    if (roleVal) params.set('role', roleVal);
    if (searchVal) params.set('q', searchVal);

    const rows = await apiGet(`/users?${params}`);
    const tbody = document.getElementById('usersTbody');

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty">
        <div class="empty-title">No users found</div>
      </div></td></tr>`;
      return;
    }

    rows.forEach(u => { _userCache[u.user_id] = u; });

    tbody.innerHTML = rows.map(u => `
      <tr>
        <td class="db-cell">#${u.user_id}</td>
        <td>${escHtml(u.first_name)}</td>
        <td>${escHtml(u.last_name)}</td>
        <td style="font-family:var(--mono);font-size:0.7rem;">${escHtml(u.email)}</td>
        <td><span class="badge b-${String(u.role).replace('_','')}">${u.role}</span></td>
        <td>${escHtml(u.department_name ?? '--')}</td>
        <td style="font-family:var(--mono);font-size:0.7rem;">${formatDatetime(u.created_at)}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openModal('grantCertModal')">
            Grant Cert
          </button>
          ${session?.role === 'admin' ? `
            <button class="btn btn-secondary btn-sm"
                    onclick="openEditUserModal(${u.user_id})">Edit</button>
            <button class="btn btn-danger btn-sm"
                    onclick="deleteUser(${u.user_id})">Delete</button>` : ''}
        </td>
      </tr>`).join('');
  } catch (_) {}
}

/* ═══════════════════════════════════════════════
   7. ANALYTICS
════════════════════════════════════════════════ */

async function loadAnalytics() {
  await Promise.all([
    loadAnalyticsDropdowns(),
    loadAnalyticsIdle(),
    loadAnalyticsTotals(),
  ]);
}

async function loadAnalyticsIdle() {
  try {
    const rows = await apiGet('/analytics/idle');
    const tbody = document.getElementById('idleTbody');

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="3"><div class="empty">
        <div class="empty-title">No idle equipment found</div>
      </div></td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(e => `
      <tr>
        <td class="db-cell">#${e.equipment_id}</td>
        <td>${escHtml(e.equipment_name)}</td>
        <td>${escHtml(e.building_name)}</td>
      </tr>`).join('');
  } catch (_) {}
}

async function loadAnalyticsTotals() {
  try {
    const data = await apiGet('/analytics/totals');
    document.getElementById('sysTotalUsers').textContent   = data.total_users   ?? '--';
    document.getElementById('sysTotalEquip').textContent   = data.total_equip   ?? '--';
    document.getElementById('sysTotalRes').textContent     = data.total_res     ?? '--';
    document.getElementById('sysTotalTickets').textContent = data.open_tickets  ?? '--';
  } catch (_) {}
}

document.getElementById('runReportBtn')?.addEventListener('click', async () => {
  const start = document.getElementById('utilStart').value;
  const end = document.getElementById('utilEnd').value;
  const buildingId = document.getElementById('utilBuilding').value;

  if (!start || !end) {
    showToast('Error', 'Please select start and end dates.');
    return;
  }

  const params = new URLSearchParams({ start_date: start, end_date: end });
  if (buildingId) params.set('building_id', buildingId);
  const deptId = document.getElementById('utilDept')?.value;
  if (deptId) params.set('department_id', deptId);

  try {
    const rows = await apiGet(`/analytics/utilization?${params}`);
    const container = document.getElementById('utilResults');

    if (!rows.length) {
      container.innerHTML = `<div class="empty" style="padding:30px;border-top:1px solid var(--border);">
        <div class="empty-title">No active reservation data in this period</div>
      </div>`;
      return;
    }

    const maxHours = Math.max(...rows.map(r => Number(r.hours_used) || 0), 1);
    container.innerHTML = `<div style="border-top:1px solid var(--border);">` +
      rows.map(r => {
        const pct = Math.round(((Number(r.hours_used) || 0) / maxHours) * 100);
        return `<div style="display:flex;align-items:center;gap:14px;padding:11px 18px;border-bottom:1px solid var(--border);font-size:0.76rem;">
          <div style="width:160px;flex-shrink:0;">${escHtml(r.equipment_name)}</div>
          <div style="flex:1;height:5px;background:var(--bg);border-radius:2px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:var(--accent);border-radius:2px;"></div>
          </div>
          <div style="width:70px;text-align:right;font-family:var(--mono);">${r.hours_used} hrs</div>
        </div>`;
      }).join('') + `</div>`;
  } catch (_) {}
});

/* ═══════════════════════════════════════════════
   8. MODAL SUBMITS
════════════════════════════════════════════════ */

document.getElementById('submitRegister')?.addEventListener('click', async () => {
  const body = {
    first_name: document.getElementById('regFirst')?.value.trim() ?? '',
    last_name:  document.getElementById('regLast')?.value.trim()  ?? '',
    email:      document.getElementById('regEmail')?.value.trim() ?? '',
    password:   document.getElementById('regPwd')?.value          ?? '',
    role:       document.getElementById('regRole')?.value         ?? '',
    department_id: document.getElementById('regDept')?.value
      ? parseInt(document.getElementById('regDept').value)
      : null
  };

  try {
    await apiSend('POST', '/auth/register', body);
    showToast('User registered', 'New account created.');
    closeModal('registerModal');
  } catch (_) {}
});

document.getElementById('submitReservation')?.addEventListener('click', async () => {
  const body = {
    equipment_id: parseInt(document.getElementById('resEquip').value),
    start_time: document.getElementById('resStart').value,
    end_time: document.getElementById('resEnd').value
  };

  try {
    await apiSend('POST', '/reservations', body);
    showToast('Reservation submitted', 'Status set to pending.');
    closeModal('reserveModal');
    loadDashboard();
    loadReservations();
  } catch (_) {}
});

document.getElementById('submitIssue')?.addEventListener('click', async () => {
  const body = {
    equipment_id: parseInt(document.getElementById('issueEquip').value),
    issue_description: document.getElementById('issueDesc').value.trim()
  };

  try {
    await apiSend('POST', '/maintenance', body);
    showToast('Issue reported', 'Equipment taken offline.');
    closeModal('issueModal');
    loadMaintenance();
  } catch (_) {}
});

document.getElementById('submitAddEquip')?.addEventListener('click', async () => {
  const body = {
    equipment_name: document.getElementById('equipName').value.trim(),
    serial_number: document.getElementById('equipSerial').value.trim(),
    equipment_type_id: parseInt(document.getElementById('equipType').value),
    building_id: parseInt(document.getElementById('equipBuilding').value),
    purchase_date: document.getElementById('equipDate').value
  };

  try {
    await apiSend('POST', '/equipment', body);
    showToast('Equipment added', 'Status set to available.');
    closeModal('addEquipModal');
    loadEquipment();
  } catch (_) {}
});

document.getElementById('submitGrantCert')?.addEventListener('click', async () => {
  const body = {
    user_id: parseInt(document.getElementById('certUser').value),
    equipment_type_id: parseInt(document.getElementById('certType').value),
    certification_date: document.getElementById('certIssued').value,
    expiration_date: document.getElementById('certExpires').value
  };

  try {
    await apiSend('POST', '/certifications', body);
    showToast('Certification granted', 'Record saved.');
    closeModal('grantCertModal');
    loadCertifications();
  } catch (_) {}
});

document.getElementById('submitEditEquip')?.addEventListener('click', async () => {
  const id   = parseInt(document.getElementById('editEquipId').value);
  const body = {
    equipment_name:    document.getElementById('editEquipName').value.trim(),
    equipment_type_id: parseInt(document.getElementById('editEquipType').value),
    building_id:       parseInt(document.getElementById('editEquipBuilding').value),
  };

  if (!body.equipment_name || !body.equipment_type_id || !body.building_id) {
    showToast('Error', 'All fields are required.');
    return;
  }

  try {
    await apiSend('PATCH', `/equipment/${id}`, body);
    showToast('Equipment updated', 'Changes saved.');
    closeModal('editEquipModal');
    loadEquipment();
  } catch (_) {}
});

document.getElementById('submitEditUser')?.addEventListener('click', async () => {
  const id   = parseInt(document.getElementById('editUserId').value);
  const body = {
    role:          document.getElementById('editUserRole').value,
    department_id: document.getElementById('editUserDept').value || null,
  };

  try {
    await apiSend('PATCH', `/users/${id}`, body);
    showToast('User updated', 'Changes saved.');
    closeModal('editUserModal');
    loadUsers();
  } catch (_) {}
});

/* ═══════════════════════════════════════════════
   9. INLINE ACTIONS
════════════════════════════════════════════════ */

async function updateResStatus(id, newStatus) {
  try {
    await apiSend('PATCH', `/reservations/${id}/status`, { status: newStatus });
    showToast('Success', `Reservation marked as ${newStatus}.`);
    // Reload UI state for whichever page is currently active
    loadDashboard();
    loadReservations();
  } catch (err) {
    console.error(err);
  }
}

async function resolveMaintenance(id) {
  await apiSend('PATCH', `/maintenance/${id}/resolve`, {});
  loadMaintenance();
  showToast('Success', 'Maintenance resolved.');
}

// Opens the reservation modal and pre-selects the equipment
function reserveEquipment(equipmentId) {
  openModal('reserveModal');
  const sel = document.getElementById('resEquip');
  if (sel) sel.value = equipmentId;
}

// Pre-fills and opens the Edit Equipment modal
function openEditEquipModal(equipmentId) {
  const e = _equipCache[equipmentId];
  if (!e) return;
  document.getElementById('editEquipId').value       = equipmentId;
  document.getElementById('editEquipName').value     = e.equipment_name;
  document.getElementById('editEquipType').value     = e.equipment_type_id;
  document.getElementById('editEquipBuilding').value = e.building_id;
  openModal('editEquipModal');
}

// Pre-fills and opens the Edit User modal
function openEditUserModal(userId) {
  const u = _userCache[userId];
  if (!u) return;
  document.getElementById('editUserId').value   = userId;
  document.getElementById('editUserName').value = `${u.first_name} ${u.last_name}`;
  document.getElementById('editUserRole').value = u.role;
  document.getElementById('editUserDept').value = u.department_id ?? '';
  openModal('editUserModal');
}

async function deleteCert(certId) {
  if (!confirm('Delete this certification? This cannot be undone.')) return;
  try {
    await apiSend('DELETE', `/certifications/${certId}`, {});
    showToast('Deleted', 'Certification removed.');
    loadCertifications();
  } catch (_) {}
}

async function deleteUser(userId) {
  if (!confirm('Delete this user account? This cannot be undone.')) return;
  try {
    await apiSend('DELETE', `/users/${userId}`, {});
    showToast('Deleted', 'User account removed.');
    loadUsers();
  } catch (_) {}
}

async function retireEquipment(equipmentId) {
  if (!confirm('Retire this equipment? It will be taken offline and cannot be reserved. This cannot be undone.')) return;
  try {
    await apiSend('DELETE', `/equipment/${equipmentId}`, {});
    showToast('Retired', 'Equipment marked as retired.');
    loadEquipment();
    loadDashboard();
  } catch (_) {}
}

/* ═══════════════════════════════════════════════
   10. MODALS
════════════════════════════════════════════════ */

document.querySelectorAll('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => openModal(btn.dataset.modal));
});

document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

/* ═══════════════════════════════════════════════
   11. UTILITIES
════════════════════════════════════════════════ */

function formatDatetime(value) {
  if (!value) return '--';

  // Strip ' GMT' or 'Z' so the browser parses it as local time
  const localString = String(value).replace(' GMT', '').replace('Z', '');

  const d = new Date(localString);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showToast(title, msg) {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.style.position = 'fixed';
    host.style.top = '18px';
    host.style.right = '18px';
    host.style.zIndex = '5000';
    host.style.display = 'flex';
    host.style.flexDirection = 'column';
    host.style.gap = '10px';
    document.body.appendChild(host);
  }

  const toast = document.createElement('div');
  toast.style.minWidth = '240px';
  toast.style.maxWidth = '340px';
  toast.style.background = '#fff';
  toast.style.border = '1px solid #ddd';
  toast.style.boxShadow = '0 8px 20px rgba(0,0,0,0.08)';
  toast.style.padding = '12px 14px';
  toast.style.borderRadius = '10px';
  toast.innerHTML = `<div style="font-weight:700;margin-bottom:4px;">${escHtml(title)}</div>
                     <div style="font-size:0.92rem;">${escHtml(msg)}</div>`;
  host.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2600);
}
