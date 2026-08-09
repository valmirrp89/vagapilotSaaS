/* ============================================================
   VagaPilot SaaS — Application Logic
   Complete client-side application with localStorage + optional Supabase
   ============================================================ */

/* ============================================================
   SECTION 1: CONFIGURATION & STATE
   ============================================================ */
const VP = {
  defaultProfile: {
    name: '', city: '', phone: '', email: '',
    area: '', years: '',
    keywords: [
      'controle de qualidade','indústria farmacêutica','análises físico-químicas',
      'matéria-prima','produto acabado','água','hplc','cromatografia gasosa','gc',
      'karl fischer','uv-vis','infravermelho','absorção atômica','validação analítica',
      'validação de processo','validação de limpeza','holding time',
      'qualificação de equipamentos','investigação de desvios','pops',
      'documentação técnica','bpf','gmp','anvisa','integridade de dados',
      'melhoria contínua','química','farmácia'
    ],
    gapTerms: [
      'oos','oot','capa','lims','sap','empower','chromeleon','tiamo','lcms',
      'cromatografia iônica','inglês intermediário','pacote office',
      'farmacopeia','elisa','pcr','cultivo celular'
    ],
    pitchTemplate: 'Sou profissional da área de [AREA], com [ANOS] de experiência. Tenho vivência prática em [SKILLS]. Atualmente [FORMACAO]. Posso contribuir com a [EMPRESA] por meio da minha experiência, atenção aos resultados e compromisso com a melhoria contínua.',
    resumeText: ''
  },
  roleProfiles: [
    { role: 'Analista de Controle de Qualidade', base: 90, terms: ['controle de qualidade','hplc','matéria-prima','produto acabado','bpf'] },
    { role: 'Analista de Laboratório Físico-Químico', base: 88, terms: ['análises físico-químicas','água','karl fischer','uv-vis'] },
    { role: 'Analista de Validação Analítica', base: 82, terms: ['validação analítica','validação de processo','validação de limpeza','holding time'] },
    { role: 'Analista de Desenvolvimento Analítico', base: 80, terms: ['desenvolvimento analítico','hplc','cromatografia gasosa'] },
    { role: 'Inspetor de Qualidade', base: 75, terms: ['qualidade','inspeção','bpf'] }
  ],
  profile: null,
  applications: [],
  supabaseClient: null,
  lastAnalysis: { score: 0, matches: [], gaps: [] }
};

/* ============================================================
   SECTION 2: UTILITY FUNCTIONS
   ============================================================ */
function $(id) { return document.getElementById(id); }

function norm(text) {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function debounce(fn, ms) {
  var timer;
  return function() {
    var args = arguments;
    var ctx = this;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, ms);
  };
}

function generateId() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxx-xxxx-4xxx-yxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function formatDate(d) {
  if (!d) d = new Date();
  if (typeof d === 'string') d = new Date(d);
  return d.toLocaleDateString('pt-BR');
}

/* ============================================================
   SECTION 3: STORAGE LAYER
   ============================================================ */
var Storage = {
  loadProfile: function() {
    try {
      var data = localStorage.getItem('vagapilot.profile');
      if (data) {
        var parsed = JSON.parse(data);
        // Merge with defaults to pick up any new fields
        return Object.assign({}, VP.defaultProfile, parsed);
      }
    } catch(e) {}
    return JSON.parse(JSON.stringify(VP.defaultProfile));
  },

  saveProfile: function(profile) {
    localStorage.setItem('vagapilot.profile', JSON.stringify(profile));
    SupabaseModule.syncProfile(profile);
  },

  loadApplications: function() {
    try {
      var data = localStorage.getItem('vagapilot.applications');
      return data ? JSON.parse(data) : [];
    } catch(e) { return []; }
  },

  saveApplications: function(apps) {
    localStorage.setItem('vagapilot.applications', JSON.stringify(apps));
    SupabaseModule.syncApplications(apps);
  },

  loadSettings: function() {
    try {
      var data = localStorage.getItem('vagapilot.settings');
      return data ? JSON.parse(data) : { url: '', key: '' };
    } catch(e) { return { url: '', key: '' }; }
  },

  saveSettings: function(settings) {
    localStorage.setItem('vagapilot.settings', JSON.stringify(settings));
  },

  exportAll: function() {
    var data = {
      profile: VP.profile,
      applications: VP.applications,
      exportDate: new Date().toISOString(),
      version: '2.0'
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vagapilot-backup-' + formatDate() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    UI.toast('Backup exportado com sucesso.', 'success');
  },

  importAll: function(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var data = JSON.parse(e.target.result);
        if (data.profile) {
          VP.profile = Object.assign({}, VP.defaultProfile, data.profile);
          Storage.saveProfile(VP.profile);
          Profile.populateFields();
        }
        if (data.applications && Array.isArray(data.applications)) {
          VP.applications = data.applications;
          Storage.saveApplications(VP.applications);
          Tracker.render();
        }
        Dashboard.update();
        UI.toast('Dados importados com sucesso!', 'success');
      } catch(err) {
        UI.toast('Erro ao importar: arquivo inválido.', 'error');
      }
    };
    reader.readAsText(file);
  }
};

/* ============================================================
   SECTION 4: SUPABASE INTEGRATION
   ============================================================ */
var SupabaseModule = {
  init: function() {
    var settings = Storage.loadSettings();
    if (settings.url && settings.key && window.supabase) {
      try {
        VP.supabaseClient = window.supabase.createClient(settings.url, settings.key);
        $('connectionDot').classList.add('connected');
        $('connectionText').textContent = 'Conectado ao Supabase';
        return true;
      } catch(e) {
        console.warn('Supabase init failed:', e);
      }
    }
    return false;
  },

  signUp: async function(email, password, name) {
    if (!VP.supabaseClient) throw new Error('Supabase não configurado. Use modo local ou configure nas Configurações.');
    var result = await VP.supabaseClient.auth.signUp({
      email: email,
      password: password,
      options: { data: { full_name: name } }
    });
    if (result.error) throw result.error;
    return result.data;
  },

  signIn: async function(email, password) {
    if (!VP.supabaseClient) throw new Error('Supabase não configurado. Use modo local ou configure nas Configurações.');
    var result = await VP.supabaseClient.auth.signInWithPassword({ email: email, password: password });
    if (result.error) throw result.error;
    return result.data;
  },

  signOut: async function() {
    if (VP.supabaseClient) {
      await VP.supabaseClient.auth.signOut();
    }
  },

  getUser: async function() {
    if (!VP.supabaseClient) return null;
    var result = await VP.supabaseClient.auth.getUser();
    return result.data ? result.data.user : null;
  },

  syncProfile: async function(profile) {
    if (!VP.supabaseClient) return;
    try {
      var user = await this.getUser();
      if (user) {
        await VP.supabaseClient.from('profiles').upsert({
          user_id: user.id,
          data: profile,
          updated_at: new Date().toISOString()
        });
      }
    } catch(e) { console.warn('Sync profile failed:', e); }
  },

  syncApplications: async function(apps) {
    if (!VP.supabaseClient) return;
    try {
      var user = await this.getUser();
      if (user) {
        await VP.supabaseClient.from('applications').upsert({
          user_id: user.id,
          data: apps,
          updated_at: new Date().toISOString()
        });
      }
    } catch(e) { console.warn('Sync apps failed:', e); }
  }
};

/* ============================================================
   SECTION 5: UI UTILITIES
   ============================================================ */
var UI = {
  toast: function(message, type) {
    type = type || 'info';
    var icons = { success: '✓', error: '✕', info: 'ℹ' };
    var container = $('toastContainer');
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML =
      '<span class="toast-icon">' + (icons[type] || 'ℹ') + '</span>' +
      '<span>' + escapeHtml(message) + '</span>' +
      '<button class="toast-close" aria-label="Fechar">×</button>';

    toast.querySelector('.toast-close').onclick = function() {
      toast.classList.add('removing');
      setTimeout(function() { toast.remove(); }, 300);
    };

    container.appendChild(toast);
    setTimeout(function() {
      if (toast.parentNode) {
        toast.classList.add('removing');
        setTimeout(function() { toast.remove(); }, 300);
      }
    }, 4500);
  },

  animateScore: function(element, target, duration) {
    duration = duration || 800;
    var el = typeof element === 'string' ? $(element) : element;
    if (!el) return;
    var start = 0;
    var startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      var current = Math.round(start + (target - start) * eased);
      el.textContent = current;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  },

  updateScoreRing: function(ringElement, score) {
    var el = typeof ringElement === 'string' ? $(ringElement) : ringElement;
    if (el) el.style.setProperty('--score', score);
  },

  confirm: function(message) {
    return new Promise(function(resolve) {
      var overlay = $('modalOverlay');
      var content = $('modalContent');
      content.innerHTML =
        '<h3>Confirmar ação</h3>' +
        '<p>' + escapeHtml(message) + '</p>' +
        '<div class="modal-actions">' +
        '<button class="btn btn-ghost" id="modalCancel">Cancelar</button>' +
        '<button class="btn btn-danger" id="modalConfirm">Confirmar</button>' +
        '</div>';
      overlay.classList.remove('hidden');

      $('modalCancel').onclick = function() { overlay.classList.add('hidden'); resolve(false); };
      $('modalConfirm').onclick = function() { overlay.classList.add('hidden'); resolve(true); };
    });
  }
};

/* ============================================================
   SECTION 6: ROUTER (SPA Navigation)
   ============================================================ */
var Router = {
  navigate: function(viewName) {
    // Hide all views
    document.querySelectorAll('.main-content .view').forEach(function(v) {
      v.classList.remove('active');
    });
    // Show target
    var target = $('view-' + viewName);
    if (target) target.classList.add('active');

    // Update nav
    document.querySelectorAll('.nav-item[data-view]').forEach(function(item) {
      item.classList.toggle('active', item.getAttribute('data-view') === viewName);
    });

    VP.currentView = viewName;
    window.location.hash = viewName;

    // Close mobile sidebar
    $('sidebar').classList.remove('open');
    $('sidebarOverlay').classList.remove('open');

    // Refresh view data
    if (viewName === 'dashboard') Dashboard.update();
    if (viewName === 'tracker') Tracker.render();
  },

  init: function() {
    // Nav item clicks
    document.querySelectorAll('.nav-item[data-view]').forEach(function(item) {
      item.addEventListener('click', function() {
        Router.navigate(this.getAttribute('data-view'));
      });
    });

    // Hash routing
    var hash = window.location.hash.replace('#', '');
    if (hash && $('view-' + hash)) {
      Router.navigate(hash);
    }

    window.addEventListener('hashchange', function() {
      var h = window.location.hash.replace('#', '');
      if (h && $('view-' + h)) Router.navigate(h);
    });

    // Hamburger
    $('hamburger').addEventListener('click', function() {
      $('sidebar').classList.toggle('open');
      $('sidebarOverlay').classList.toggle('open');
    });
    $('sidebarOverlay').addEventListener('click', function() {
      $('sidebar').classList.remove('open');
      $('sidebarOverlay').classList.remove('open');
    });
  }
};

/* ============================================================
   SECTION 7: AUTH MODULE
   ============================================================ */
var Auth = {
  isGuest: false,

  init: function() {
    var self = this;

    // Check for guest mode
    if (localStorage.getItem('vagapilot.guest') === 'true') {
      self.isGuest = true;
      self.showApp();
      return;
    }

    // Check Supabase session
    if (VP.supabaseClient) {
      SupabaseModule.getUser().then(function(user) {
        if (user) {
          self.showApp(user);
        }
      });
    }

    // Event listeners
    $('loginBtn').addEventListener('click', function() { self.login(); });
    $('registerBtn').addEventListener('click', function() { self.register(); });
    $('guestBtn').addEventListener('click', function() { self.loginAsGuest(); });
    $('logoutBtn').addEventListener('click', function() { self.logout(); });
    $('toggleAuthMode').addEventListener('click', function() { self.toggleMode(); });

    // Form submit via Enter
    $('auth-login-form').addEventListener('submit', function(e) { e.preventDefault(); self.login(); });
    $('auth-register-form').addEventListener('submit', function(e) { e.preventDefault(); self.register(); });
  },

  toggleMode: function() {
    var loginForm = $('auth-login-form');
    var regForm = $('auth-register-form');
    var toggleText = $('authToggleText');
    var toggleBtn = $('toggleAuthMode');

    if (loginForm.classList.contains('hidden')) {
      loginForm.classList.remove('hidden');
      regForm.classList.add('hidden');
      toggleText.textContent = 'Não tem conta?';
      toggleBtn.textContent = 'Cadastre-se';
    } else {
      loginForm.classList.add('hidden');
      regForm.classList.remove('hidden');
      toggleText.textContent = 'Já tem conta?';
      toggleBtn.textContent = 'Fazer login';
    }
  },

  login: async function() {
    var email = $('authEmail').value.trim();
    var password = $('authPassword').value;
    if (!email || !password) { UI.toast('Preencha e-mail e senha.', 'error'); return; }

    try {
      var data = await SupabaseModule.signIn(email, password);
      if (data.user) {
        this.showApp(data.user);
        UI.toast('Login realizado com sucesso!', 'success');
      }
    } catch(e) {
      UI.toast(e.message || 'Erro ao fazer login. Verifique as credenciais.', 'error');
    }
  },

  register: async function() {
    var name = $('authName').value.trim();
    var email = $('authEmailReg').value.trim();
    var password = $('authPasswordReg').value;
    if (!name || !email || !password) { UI.toast('Preencha todos os campos.', 'error'); return; }
    if (password.length < 6) { UI.toast('A senha deve ter ao menos 6 caracteres.', 'error'); return; }

    try {
      var data = await SupabaseModule.signUp(email, password, name);
      UI.toast('Conta criada! Verifique seu e-mail para confirmar.', 'success');
      this.toggleMode();
    } catch(e) {
      UI.toast(e.message || 'Erro ao criar conta.', 'error');
    }
  },

  loginAsGuest: function() {
    localStorage.setItem('vagapilot.guest', 'true');
    this.isGuest = true;
    this.showApp();
    UI.toast('Usando modo local. Seus dados ficarão salvos neste navegador.', 'info');
  },

  showApp: function(user) {
    $('view-auth').classList.add('hidden');
    $('app-shell').classList.remove('hidden');
    $('hamburger').style.display = '';

    if (user) {
      var name = (user.user_metadata && user.user_metadata.full_name) || user.email;
      $('userDisplayName').textContent = name;
      $('userDisplayEmail').textContent = user.email;
      $('userAvatar').textContent = name.slice(0, 2).toUpperCase();
    } else if (VP.profile && VP.profile.name) {
      $('userDisplayName').textContent = VP.profile.name;
      $('userDisplayEmail').textContent = VP.profile.email || 'Modo local';
      $('userAvatar').textContent = VP.profile.name.slice(0, 2).toUpperCase();
    } else {
      $('userDisplayName').textContent = 'Usuário';
      $('userDisplayEmail').textContent = 'Modo local';
      $('userAvatar').textContent = '?';
    }
  },

  logout: async function() {
    var confirmed = await UI.confirm('Deseja realmente sair?');
    if (!confirmed) return;

    await SupabaseModule.signOut();
    localStorage.removeItem('vagapilot.guest');
    this.isGuest = false;

    $('view-auth').classList.remove('hidden');
    $('app-shell').classList.add('hidden');
    UI.toast('Você saiu com sucesso.', 'info');
  }
};

/* ============================================================
   SECTION 8: PROFILE MODULE
   ============================================================ */
var Profile = {
  init: function() {
    var self = this;
    this.populateFields();

    // Save button
    $('saveProfileBtn').addEventListener('click', function() { self.save(); });

    // Keywords
    $('addKeywordBtn').addEventListener('click', function() {
      self.addKeyword($('keywordInput').value.trim());
      $('keywordInput').value = '';
    });
    $('keywordInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        self.addKeyword(this.value.trim());
        this.value = '';
      }
    });

    // Gap terms
    $('addGapTermBtn').addEventListener('click', function() {
      self.addGapTerm($('gapTermInput').value.trim());
      $('gapTermInput').value = '';
    });
    $('gapTermInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        self.addGapTerm(this.value.trim());
        this.value = '';
      }
    });

    // Resume analyze
    $('analyzeResumeBtn').addEventListener('click', function() {
      self.analyzeResume();
      UI.toast('Análise profissional atualizada.', 'success');
    });

    // File upload
    $('resumeFile').addEventListener('change', function(e) {
      if (e.target.files[0]) self.handleResumeFile(e.target.files[0]);
    });

    // Drag and drop
    var zone = $('uploadZone');
    ['dragenter', 'dragover'].forEach(function(type) {
      zone.addEventListener(type, function(e) { e.preventDefault(); zone.classList.add('dragging'); });
    });
    ['dragleave', 'drop'].forEach(function(type) {
      zone.addEventListener(type, function(e) { e.preventDefault(); zone.classList.remove('dragging'); });
    });
    zone.addEventListener('drop', function(e) {
      if (e.dataTransfer.files[0]) self.handleResumeFile(e.dataTransfer.files[0]);
    });
    zone.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { $('resumeFile').click(); e.preventDefault(); }
    });

    // Remove file
    $('removeFile').addEventListener('click', function() {
      $('resumeText').value = '';
      $('fileStatus').classList.add('hidden');
      localStorage.removeItem('vagapilot.fileName');
      self.analyzeResume();
      UI.toast('Currículo removido.', 'info');
    });

    // Initial analysis
    this.analyzeResume();
  },

  populateFields: function() {
    var p = VP.profile;
    $('profileName').value = p.name || '';
    $('profileCity').value = p.city || '';
    $('profilePhone').value = p.phone || '';
    $('profileEmail').value = p.email || '';
    $('profileArea').value = p.area || '';
    $('profileYears').value = p.years || '';
    $('pitchTemplate').value = p.pitchTemplate || VP.defaultProfile.pitchTemplate;
    $('resumeText').value = p.resumeText || '';
    if (p.years) $('profileYearsMetric').textContent = p.years;

    this.renderChips('keywordsList', p.keywords, 'success', this.removeKeyword.bind(this));
    this.renderChips('gapTermsList', p.gapTerms, 'warning', this.removeGapTerm.bind(this));

    // Update user sidebar
    if (p.name) {
      $('userDisplayName').textContent = p.name;
      $('userAvatar').textContent = p.name.slice(0, 2).toUpperCase();
    }
    if (p.email) $('userDisplayEmail').textContent = p.email;
  },

  save: function() {
    VP.profile.name = $('profileName').value.trim();
    VP.profile.city = $('profileCity').value.trim();
    VP.profile.phone = $('profilePhone').value.trim();
    VP.profile.email = $('profileEmail').value.trim();
    VP.profile.area = $('profileArea').value.trim();
    VP.profile.years = $('profileYears').value.trim();
    VP.profile.pitchTemplate = $('pitchTemplate').value.trim() || VP.defaultProfile.pitchTemplate;
    VP.profile.resumeText = $('resumeText').value.trim();

    Storage.saveProfile(VP.profile);
    this.populateFields();
    this.analyzeResume();
    UI.toast('Perfil salvo com sucesso!', 'success');
  },

  addKeyword: function(word) {
    if (!word) return;
    var normalized = norm(word);
    var exists = VP.profile.keywords.some(function(k) { return norm(k) === normalized; });
    if (exists) { UI.toast('Essa competência já existe.', 'info'); return; }
    VP.profile.keywords.push(word.toLowerCase());
    Storage.saveProfile(VP.profile);
    this.renderChips('keywordsList', VP.profile.keywords, 'success', this.removeKeyword.bind(this));
  },

  removeKeyword: function(word) {
    VP.profile.keywords = VP.profile.keywords.filter(function(k) { return k !== word; });
    Storage.saveProfile(VP.profile);
    this.renderChips('keywordsList', VP.profile.keywords, 'success', this.removeKeyword.bind(this));
  },

  addGapTerm: function(word) {
    if (!word) return;
    var normalized = norm(word);
    var exists = VP.profile.gapTerms.some(function(k) { return norm(k) === normalized; });
    if (exists) { UI.toast('Esse termo já existe.', 'info'); return; }
    VP.profile.gapTerms.push(word.toLowerCase());
    Storage.saveProfile(VP.profile);
    this.renderChips('gapTermsList', VP.profile.gapTerms, 'warning', this.removeGapTerm.bind(this));
  },

  removeGapTerm: function(word) {
    VP.profile.gapTerms = VP.profile.gapTerms.filter(function(k) { return k !== word; });
    Storage.saveProfile(VP.profile);
    this.renderChips('gapTermsList', VP.profile.gapTerms, 'warning', this.removeGapTerm.bind(this));
  },

  renderChips: function(containerId, items, type, removeCallback) {
    var container = $(containerId);
    if (!items || !items.length) {
      container.innerHTML = '<span class="chips-empty">Nenhum termo adicionado.</span>';
      return;
    }
    container.innerHTML = items.map(function(item) {
      return '<span class="chip chip-' + type + '">' +
        escapeHtml(item) +
        '<button class="chip-remove" data-word="' + escapeHtml(item) + '" aria-label="Remover">×</button>' +
        '</span>';
    }).join('');

    container.querySelectorAll('.chip-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        removeCallback(this.getAttribute('data-word'));
      });
    });
  },

  /* ---------- Resume File Extraction ---------- */
  handleResumeFile: async function(file) {
    if (!file) return;
    var ext = file.name.split('.').pop().toLowerCase();
    if (['docx', 'txt', 'rtf'].indexOf(ext) === -1) {
      UI.toast('Formato não compatível. Use DOCX, TXT ou RTF.', 'error');
      return;
    }

    try {
      $('uploadZone').classList.add('loading');
      var text;

      if (ext === 'docx') {
        text = await this.extractDocx(await file.arrayBuffer());
      } else {
        var raw = await file.text();
        text = ext === 'rtf' ? this.extractRtf(raw) : raw;
      }

      if (text.trim().length < 80) throw new Error('Pouco texto encontrado no arquivo.');

      $('resumeText').value = text.trim();
      $('fileName').textContent = file.name;
      $('fileMeta').textContent = Math.ceil(file.size / 1024) + ' KB · ' + text.trim().split(/\s+/).length + ' palavras';
      $('fileStatus').classList.remove('hidden');
      localStorage.setItem('vagapilot.fileName', file.name);
      this.analyzeResume();
      UI.toast('Currículo importado e analisado.', 'success');
    } catch(error) {
      UI.toast(error.message || 'Não foi possível analisar o arquivo.', 'error');
    } finally {
      $('uploadZone').classList.remove('loading');
      $('resumeFile').value = '';
    }
  },

  inflateRaw: async function(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Use Chrome ou Edge atualizado.');
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  },

  extractDocx: async function(buffer) {
    var data = new Uint8Array(buffer);
    var view = new DataView(buffer);
    var eocd = -1;

    for (var i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Arquivo DOCX inválido ou danificado.');

    var entries = view.getUint16(eocd + 10, true);
    var central = view.getUint32(eocd + 16, true);
    var decoder = new TextDecoder('utf-8');
    var pos = central;
    var target = null;

    for (var j = 0; j < entries; j++) {
      if (view.getUint32(pos, true) !== 0x02014b50) break;
      var compression = view.getUint16(pos + 10, true);
      var size = view.getUint32(pos + 20, true);
      var nameLen = view.getUint16(pos + 28, true);
      var extraLen = view.getUint16(pos + 30, true);
      var commentLen = view.getUint16(pos + 32, true);
      var local = view.getUint32(pos + 42, true);
      var name = decoder.decode(data.slice(pos + 46, pos + 46 + nameLen));
      if (name === 'word/document.xml') target = { compression: compression, size: size, local: local };
      pos += 46 + nameLen + extraLen + commentLen;
    }

    if (!target) throw new Error('Texto principal não encontrado no DOCX.');

    var nameL = view.getUint16(target.local + 26, true);
    var extraL = view.getUint16(target.local + 28, true);
    var start = target.local + 30 + nameL + extraL;
    var packed = data.slice(start, start + target.size);
    var raw = target.compression === 0 ? packed :
              target.compression === 8 ? await this.inflateRaw(packed) : null;

    if (!raw) throw new Error('Compactação não compatível.');

    var xml = decoder.decode(raw);
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    var paras = Array.from(doc.getElementsByTagNameNS(ns, 'p'));

    return paras.map(function(p) {
      return Array.from(p.getElementsByTagNameNS(ns, 't')).map(function(t) {
        return t.textContent;
      }).join('');
    }).filter(Boolean).join('\n');
  },

  extractRtf: function(text) {
    return text
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
      .replace(/\\[a-zA-Z]+-?\d* ?/g, ' ')
      .replace(/[{}]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  },

  /* ---------- Resume Analysis ---------- */
  analyzeResume: function() {
    var text = $('resumeText').value.trim();
    var n = norm(text);

    // Count recognized keywords
    var recognized = VP.profile.keywords.filter(function(k) {
      var pattern = norm(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try { return new RegExp('\\b' + pattern + '\\b', 'i').test(n); }
      catch(e) { return n.indexOf(norm(k)) !== -1; }
    });

    var hasMetrics = /\b\d+\s*(anos|%|lotes|métodos|analises|análises)\b/i.test(text);
    var hasEducation = /bacharel|graduação|farmácia|química/i.test(text);
    var hasRecent = /atual|2024|2025|2026/i.test(text);

    var score = Math.min(96, 55 + recognized.length + (hasMetrics ? 5 : 0) + (hasEducation ? 5 : 0) + (hasRecent ? 4 : 0));
    if (!text) score = 0;

    $('resumeScore').textContent = score + '%';
    $('keywordMetric').textContent = recognized.length;
    if (VP.profile.years) $('profileYearsMetric').textContent = VP.profile.years;

    // Profile level
    var level = score >= 88 ? 'Perfil técnico muito competitivo' :
                score >= 75 ? 'Perfil competitivo com ajustes pontuais' :
                score > 0 ? 'Perfil com potencial de fortalecimento' : 'Perfil em análise';
    $('profileLevel').textContent = level;
    $('profileSummary').textContent = text
      ? 'Seu histórico apresenta competências reconhecidas no setor. O posicionamento ideal depende dos requisitos formais de cada empresa.'
      : 'Execute a análise para receber uma avaliação detalhada.';

    // Strengths and improvements
    var strengths = [];
    var improvements = [];

    if (recognized.length > 5) strengths.push('Amplo domínio de competências técnicas');
    if (hasMetrics) strengths.push('Resultados mensuráveis no currículo');
    if (hasEducation) strengths.push('Formação acadêmica relevante');
    if (n.indexOf('hplc') !== -1 || n.indexOf('cromatografia') !== -1) strengths.push('Domínio de técnicas cromatográficas');
    if (n.indexOf('validacao') !== -1 || n.indexOf('validação') !== -1) strengths.push('Experiência em validações');
    if (n.indexOf('bpf') !== -1 || n.indexOf('gmp') !== -1) strengths.push('Conhecimento de BPF/GMP');
    if (n.indexOf('farmaceutica') !== -1 || n.indexOf('farmacêutica') !== -1) strengths.push('Vivência na indústria farmacêutica');

    if (!hasMetrics) improvements.push('Adicionar resultados mensuráveis');
    if (n.indexOf('lims') === -1 && n.indexOf('sap') === -1) improvements.push('Informar sistemas laboratoriais utilizados');
    if (n.indexOf('ingles') === -1 && n.indexOf('inglês') === -1) improvements.push('Declarar nível de inglês');
    if (n.indexOf('oos') === -1) improvements.push('Detalhar experiência com OOS/OOT');
    if (n.indexOf('farmacopeia') === -1) improvements.push('Mencionar farmacopeias conhecidas');

    if (!strengths.length) strengths.push('Analise seu currículo para ver os pontos fortes.');
    if (!improvements.length) improvements.push('Nenhuma sugestão de melhoria no momento.');

    $('strengths').innerHTML = strengths.map(function(s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('');
    $('improvements').innerHTML = improvements.map(function(s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('');

    // Role ranking
    var ranked = VP.roleProfiles.map(function(r) {
      var matchCount = r.terms.filter(function(t) {
        var pattern = norm(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        try { return new RegExp('\\b' + pattern + '\\b', 'i').test(n); }
        catch(e) { return n.indexOf(norm(t)) !== -1; }
      }).length;
      return { role: r.role, score: Math.min(98, r.base + matchCount * 2) };
    }).sort(function(a, b) { return b.score - a.score; });

    $('roleRanking').innerHTML = ranked.map(function(r, i) {
      return '<button class="role-btn" data-role="' + escapeHtml(r.role) + '">' +
        '<span class="role-num">' + (i + 1) + '</span>' +
        '<div><strong>' + escapeHtml(r.role) + '</strong>' +
        '<div class="role-bar"><span class="role-bar-fill" style="width:' + r.score + '%"></span></div></div>' +
        '<span class="role-score">' + r.score + '%</span>' +
        '</button>';
    }).join('');

    // Click role to set search role
    $('roleRanking').querySelectorAll('.role-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var role = this.getAttribute('data-role');
        $('searchRole').value = role;
        Analyzer.generateSearch();
        Router.navigate('analyzer');
      });
    });

    // Also update search role dropdown options
    var searchSelect = $('searchRole');
    searchSelect.innerHTML = ranked.map(function(r) {
      return '<option>' + escapeHtml(r.role) + '</option>';
    }).join('');
  }
};

/* ============================================================
   SECTION 9: ANALYZER MODULE (Job Analysis)
   ============================================================ */
var Analyzer = {
  init: function() {
    var self = this;

    // Real-time analysis (debounced)
    $('jobDescription').addEventListener('input', debounce(function() { self.analyze(); }, 300));

    // Company input updates pitch
    $('jobCompany').addEventListener('input', debounce(function() { self.updatePitch(); }, 300));

    // URL shows/hides open link
    $('jobUrl').addEventListener('input', function() {
      var link = $('openJobLink');
      link.href = this.value;
      link.classList.toggle('hidden', !this.value.trim());
    });

    // Buttons
    $('analyzeBtn').addEventListener('click', function() { self.analyze(); self.saveApplication(); });
    $('saveAppBtn').addEventListener('click', function() { self.saveApplication(); });
    $('copyPitchBtn').addEventListener('click', function() { self.copyPitch(); });
    $('searchBtn').addEventListener('click', function() { self.generateSearch(); });

    // Initial search links
    this.generateSearch();
  },

  analyze: function() {
    var description = $('jobDescription').value;
    var descNorm = norm(description);

    if (!description.trim()) {
      $('scoreValue').textContent = '0';
      UI.updateScoreRing('scoreRing', 0);
      $('scoreTitle').textContent = 'Aguardando vaga';
      $('matchChips').innerHTML = '<span class="chips-empty">Cole uma descrição para começar.</span>';
      $('gapChips').innerHTML = '<span class="chips-empty">Nenhuma lacuna identificada.</span>';
      $('matchCount').textContent = '0';
      $('gapCount').textContent = '0';
      VP.lastAnalysis = { score: 0, matches: [], gaps: [] };
      return;
    }

    // Match keywords using regex word boundaries
    var matches = VP.profile.keywords.filter(function(k) {
      var pattern = norm(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        // For short terms (≤3 chars), require exact word boundary
        return new RegExp('\\b' + pattern + '\\b', 'i').test(descNorm);
      } catch(e) {
        return descNorm.indexOf(norm(k)) !== -1;
      }
    });

    // Find gaps
    var gaps = VP.profile.gapTerms.filter(function(k) {
      var pattern = norm(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        return new RegExp('\\b' + pattern + '\\b', 'i').test(descNorm);
      } catch(e) {
        return descNorm.indexOf(norm(k)) !== -1;
      }
    });

    // Calculate score
    var score = Math.max(0, Math.min(96,
      48 + matches.length * 3 +
      Math.min(22, Math.floor(description.length / 240)) -
      gaps.length * 3
    ));

    VP.lastAnalysis = { score: score, matches: matches, gaps: gaps };

    // Animate score
    UI.animateScore('scoreValue', score);
    UI.updateScoreRing('scoreRing', score);

    // Score title
    $('scoreTitle').textContent =
      score >= 80 ? 'Ótima oportunidade' :
      score >= 65 ? 'Boa oportunidade' :
      score > 0 ? 'Avalie as lacunas' : 'Aguardando vaga';

    // Render chips
    $('matchChips').innerHTML = matches.length
      ? matches.map(function(m) { return '<span class="chip chip-success">' + escapeHtml(m) + '</span>'; }).join('')
      : '<span class="chips-empty">Nenhuma competência encontrada.</span>';

    $('gapChips').innerHTML = gaps.length
      ? gaps.map(function(g) { return '<span class="chip chip-warning">' + escapeHtml(g) + '</span>'; }).join('')
      : '<span class="chips-empty">Nenhuma lacuna identificada.</span>';

    $('matchCount').textContent = matches.length;
    $('gapCount').textContent = gaps.length;

    // Generate pitch
    this.updatePitch();
  },

  updatePitch: function() {
    var template = VP.profile.pitchTemplate || VP.defaultProfile.pitchTemplate;
    var company = $('jobCompany').value.trim() || 'empresa';
    var skills = VP.lastAnalysis.matches.slice(0, 5).join(', ') || VP.profile.area || 'suas competências';
    var resumeText = VP.profile.resumeText || '';

    // Extract education info from resume
    var formacao = '';
    var eduMatch = resumeText.match(/(cursando|graduação em|bacharel em|pós-graduação em|especialização em)[^.,]*/i);
    if (eduMatch) formacao = eduMatch[0].trim();
    else formacao = 'busco aprimoramento contínuo';

    var pitch = template
      .replace(/\[AREA\]/g, VP.profile.area || 'minha área de atuação')
      .replace(/\[ANOS\]/g, VP.profile.years || 'vários anos')
      .replace(/\[EMPRESA\]/g, company)
      .replace(/\[SKILLS\]/g, skills)
      .replace(/\[FORMACAO\]/g, formacao);

    $('pitchOutput').textContent = pitch;
  },

  copyPitch: async function() {
    var text = $('pitchOutput').textContent;
    if (!text) { UI.toast('Nenhuma apresentação para copiar.', 'info'); return; }
    try {
      await navigator.clipboard.writeText(text);
      UI.toast('Apresentação copiada!', 'success');
    } catch(e) {
      UI.toast('Erro ao copiar. Selecione o texto manualmente.', 'error');
    }
  },

  saveApplication: function() {
    var company = $('jobCompany').value.trim();
    var role = $('jobRole').value.trim();
    var url = $('jobUrl').value.trim();

    if (!company || !role) {
      UI.toast('Informe a empresa e o cargo antes de salvar.', 'error');
      return;
    }

    // Check duplicate by URL
    if (url && VP.applications.some(function(a) { return a.url === url; })) {
      UI.toast('Esta vaga já está no histórico.', 'info');
      return;
    }

    VP.applications.unshift({
      id: generateId(),
      company: company,
      role: role,
      url: url,
      score: VP.lastAnalysis.score,
      pitch: $('pitchOutput').textContent,
      matches: VP.lastAnalysis.matches,
      gaps: VP.lastAnalysis.gaps,
      status: 'Preparada',
      date: new Date().toISOString()
    });

    Storage.saveApplications(VP.applications);
    UI.toast('Candidatura preparada e adicionada ao histórico!', 'success');

    // Clear form for next job
    $('jobDescription').value = '';
    $('jobUrl').value = '';
    $('openJobLink').classList.add('hidden');
    this.analyze(); // Reset analysis display
  },

  generateSearch: function() {
    var role = $('searchRole').value || 'Profissional';
    var loc = $('searchLocation').value.trim();
    var useKeywords = $('searchUseKeywords').checked;
    var remote = $('searchRemote').checked;

    var keywords = [];
    if (useKeywords && VP.profile.keywords && VP.profile.keywords.length > 0) {
      keywords = VP.profile.keywords.slice(0, 5).map(function(k) { return '"' + k + '"'; });
    }

    var keywordString = keywords.length ? ' AND (' + keywords.join(' OR ') + ')' : '';
    var remoteString = remote ? ' AND (remoto OR remote OR "home office")' : '';
    var locationString = loc && !remote ? ' AND "' + loc + '"' : '';

    var links = [];

    // 1. Gupy X-Ray (Google)
    var gupyQuery = 'site:gupy.io/job "' + role + '"' + keywordString + locationString + remoteString;
    links.push(['Gupy (X-Ray)', 'https://www.google.com/search?q=' + encodeURIComponent(gupyQuery), '🟢']);

    // 2. ATS Globais X-Ray (Google)
    var atsQuery = '(site:jobs.lever.co OR site:boards.greenhouse.io OR site:apply.workable.com) "' + role + '"' + keywordString + locationString + remoteString;
    links.push(['ATS Globais (X-Ray)', 'https://www.google.com/search?q=' + encodeURIComponent(atsQuery), '🌐']);

    // 3. LinkedIn Boolean
    var liKeywords = '"' + role + '"' + keywordString + remoteString;
    var liLoc = remote ? 'Brazil' : loc;
    links.push(['LinkedIn Boolean', 'https://www.linkedin.com/jobs/search/?keywords=' + encodeURIComponent(liKeywords) + (liLoc ? '&location=' + encodeURIComponent(liLoc) : '') + (remote ? '&f_WT=2' : ''), '🔷']);

    // 4. Vagas.com (Native)
    var slug = norm(role).replace(/\s+/g, '-');
    links.push(['Vagas.com', 'https://www.vagas.com.br/vagas-de-' + slug + (loc && !remote ? '/' + norm(loc).replace(/\s+/g, '-') : ''), '🔵']);

    // 5. Indeed (Native)
    var indeedQuery = '"' + role + '"' + (keywords.length ? ' ' + keywords.map(function(k){return k.replace(/"/g,'');}).join(' ') : '') + (remote ? ' remoto' : '');
    links.push(['Indeed', 'https://br.indeed.com/jobs?q=' + encodeURIComponent(indeedQuery) + (loc && !remote ? '&l=' + encodeURIComponent(loc) : ''), '🟣']);

    $('searchLinks').innerHTML = links.map(function(l) {
      return '<a class="search-link" href="' + l[1] + '" target="_blank" rel="noreferrer">' +
        '<strong>' + l[2] + ' ' + l[0] + '</strong>' +
        '<span>Abrir pesquisa avançada ↗</span></a>';
    }).join('');
  }
};

/* ============================================================
   SECTION 10: TRACKER MODULE
   ============================================================ */
var Tracker = {
  init: function() {
    var self = this;
    this.render();

    $('exportBtn').addEventListener('click', function() { Storage.exportAll(); });
    $('importBtn').addEventListener('click', function() { $('importFile').click(); });
    $('importFile').addEventListener('change', function(e) {
      if (e.target.files[0]) Storage.importAll(e.target.files[0]);
      e.target.value = '';
    });
  },

  render: function() {
    var list = $('applicationList');
    var empty = $('emptyState');

    if (!VP.applications.length) {
      empty.classList.remove('hidden');
      list.innerHTML = '';
      return;
    }

    empty.classList.add('hidden');
    list.innerHTML = VP.applications.map(function(a) {
      var scoreClass = a.score >= 80 ? 'badge-high' : a.score >= 50 ? 'badge-medium' : 'badge-low';
      var statusOptions = ['Preparada', 'Enviada', 'Entrevista', 'Encerrada'].map(function(s) {
        return '<option' + (a.status === s ? ' selected' : '') + '>' + s + '</option>';
      }).join('');

      return '<article class="app-row">' +
        '<div class="company-mark">' + escapeHtml(a.company.slice(0, 2).toUpperCase()) + '</div>' +
        '<div class="app-info"><strong>' + escapeHtml(a.role) + '</strong>' +
        '<span>' + escapeHtml(a.company) + ' · ' + formatDate(a.date) + '</span></div>' +
        '<span class="badge ' + scoreClass + '">' + a.score + '% aderência</span>' +
        '<select data-id="' + a.id + '">' + statusOptions + '</select>' +
        (a.url ? '<a class="app-link" href="' + escapeHtml(a.url) + '" target="_blank">Abrir ↗</a>' : '<span></span>') +
        '<button class="btn-delete" data-id="' + a.id + '" title="Excluir">🗑️</button>' +
        '</article>';
    }).join('');

    // Status change handlers
    list.querySelectorAll('select').forEach(function(sel) {
      sel.addEventListener('change', function() {
        Tracker.updateStatus(this.getAttribute('data-id'), this.value);
      });
    });

    // Delete handlers
    list.querySelectorAll('.btn-delete').forEach(function(btn) {
      btn.addEventListener('click', function() {
        Tracker.delete(this.getAttribute('data-id'));
      });
    });
  },

  updateStatus: function(id, status) {
    var app = VP.applications.find(function(a) { return a.id === id; });
    if (app) {
      app.status = status;
      Storage.saveApplications(VP.applications);
      UI.toast('Status atualizado para "' + status + '".', 'success');
    }
  },

  delete: async function(id) {
    var confirmed = await UI.confirm('Deseja remover esta candidatura do histórico?');
    if (!confirmed) return;
    VP.applications = VP.applications.filter(function(a) { return a.id !== id; });
    Storage.saveApplications(VP.applications);
    this.render();
    UI.toast('Candidatura removida.', 'info');
  }
};

/* ============================================================
   SECTION 11: DASHBOARD MODULE
   ============================================================ */
var Dashboard = {
  update: function() {
    var apps = VP.applications;
    var total = apps.length;
    var sent = apps.filter(function(a) { return a.status === 'Enviada'; }).length;
    var interviews = apps.filter(function(a) { return a.status === 'Entrevista'; }).length;
    var avgScore = total ? Math.round(apps.reduce(function(sum, a) { return sum + (a.score || 0); }, 0) / total) : 0;

    UI.animateScore('totalApps', total);
    UI.animateScore('sentCount', sent);
    UI.animateScore('interviewCount', interviews);

    var avgEl = $('avgScore');
    UI.animateScore(avgEl, avgScore);
    // Append % after animation
    setTimeout(function() { avgEl.textContent = avgScore + '%'; }, 850);

    // Dashboard resume score
    var resumeText = ($('resumeText') && $('resumeText').value) || '';
    var recognized = VP.profile.keywords.filter(function(k) {
      var n = norm(resumeText);
      var pattern = norm(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try { return new RegExp('\\b' + pattern + '\\b', 'i').test(n); }
      catch(e) { return n.indexOf(norm(k)) !== -1; }
    });

    var resumeScore = resumeText ? Math.min(96, 55 + recognized.length) : 0;
    $('dashResumeScore').textContent = resumeScore + '%';
    UI.updateScoreRing('dashScoreRing', resumeScore);

    var dashLevel = resumeScore >= 88 ? 'Perfil muito competitivo' :
                    resumeScore >= 75 ? 'Perfil competitivo' :
                    resumeScore > 0 ? 'Perfil em fortalecimento' : 'Perfil em análise';
    $('dashProfileLevel').textContent = dashLevel;

    // Top roles
    var roleHtml = VP.roleProfiles.slice(0, 3).map(function(r, i) {
      return '<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">' +
        '<span class="role-num" style="width:22px;height:22px;border-radius:6px;background:var(--accent-subtle);color:var(--accent);display:grid;place-items:center;font-size:10px;font-weight:700;">' + (i + 1) + '</span>' +
        '<span style="font-size:12px;">' + escapeHtml(r.role) + '</span></div>';
    }).join('');
    $('dashTopRoles').innerHTML = roleHtml || '<p>Analise seu perfil para ver os cargos ideais.</p>';

    // Recent activity
    var recent = apps.slice(0, 5);
    if (recent.length) {
      $('recentActivity').innerHTML = recent.map(function(a) {
        return '<div style="display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--border-color);">' +
          '<div class="company-mark" style="width:32px;height:32px;border-radius:8px;font-size:10px;">' + escapeHtml(a.company.slice(0, 2).toUpperCase()) + '</div>' +
          '<div style="flex:1;min-width:0;"><strong style="font-size:12px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(a.role) + '</strong>' +
          '<span style="font-size:10px;color:var(--text-secondary);">' + escapeHtml(a.company) + ' · ' + formatDate(a.date) + '</span></div>' +
          '<span class="badge ' + (a.score >= 80 ? 'badge-high' : 'badge-medium') + '" style="font-size:10px;">' + a.score + '%</span></div>';
      }).join('');
    } else {
      $('recentActivity').innerHTML = '<div class="empty-state" style="padding:24px 0;"><p>Nenhuma candidatura registrada ainda.</p></div>';
    }
  }
};

/* ============================================================
   SECTION 12: SETTINGS MODULE
   ============================================================ */
var Settings = {
  init: function() {
    var self = this;
    var settings = Storage.loadSettings();
    $('supabaseUrl').value = settings.url || '';
    $('supabaseKey').value = settings.key || '';

    $('saveSettingsBtn').addEventListener('click', function() { self.save(); });

    // Theme toggle
    $('themeToggle').addEventListener('click', function() {
      document.body.classList.toggle('light');
      var isLight = document.body.classList.contains('light');
      localStorage.setItem('vagapilot.theme', isLight ? 'light' : 'dark');
      $('themeIcon').textContent = isLight ? '☀️' : '🌙';
      $('themeLabel').textContent = isLight ? 'Modo escuro' : 'Modo claro';
    });

    // Export all
    $('exportAllBtn').addEventListener('click', function() { Storage.exportAll(); });

    // Clear data
    $('clearDataBtn').addEventListener('click', async function() {
      var confirmed = await UI.confirm('Tem certeza? Todos os dados do VagaPilot serão apagados permanentemente.');
      if (!confirmed) return;
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i).startsWith('vagapilot.')) keys.push(localStorage.key(i));
      }
      keys.forEach(function(k) { localStorage.removeItem(k); });
      VP.profile = JSON.parse(JSON.stringify(VP.defaultProfile));
      VP.applications = [];
      Profile.populateFields();
      Tracker.render();
      Dashboard.update();
      UI.toast('Todos os dados foram apagados.', 'info');
    });

    // Update connection status
    if (VP.supabaseClient) {
      $('connectionDot').classList.add('connected');
      $('connectionText').textContent = 'Conectado ao Supabase';
    }
  },

  save: function() {
    var url = $('supabaseUrl').value.trim();
    var key = $('supabaseKey').value.trim();
    Storage.saveSettings({ url: url, key: key });

    if (url && key) {
      var connected = SupabaseModule.init();
      if (connected) {
        UI.toast('Conexão com Supabase estabelecida!', 'success');
      } else {
        UI.toast('Não foi possível conectar. Verifique URL e chave.', 'error');
      }
    } else {
      VP.supabaseClient = null;
      $('connectionDot').classList.remove('connected');
      $('connectionText').textContent = 'Desconectado — usando dados locais';
      UI.toast('Configuração salva. Usando modo local.', 'info');
    }
  }
};

/* ============================================================
   SECTION 13: APP INITIALIZATION
   ============================================================ */
document.addEventListener('DOMContentLoaded', function() {
  // Load data
  VP.profile = Storage.loadProfile();
  VP.applications = Storage.loadApplications();

  // Apply saved theme
  var savedTheme = localStorage.getItem('vagapilot.theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light');
    if ($('themeIcon')) $('themeIcon').textContent = '☀️';
    if ($('themeLabel')) $('themeLabel').textContent = 'Modo escuro';
  }

  // Try Supabase
  SupabaseModule.init();

  // Init modules
  Auth.init();
  Router.init();
  Profile.init();
  Analyzer.init();
  Tracker.init();
  Dashboard.update();
  Settings.init();

  // Restore file status if exists
  var savedFileName = localStorage.getItem('vagapilot.fileName');
  if (savedFileName) {
    $('fileName').textContent = savedFileName;
    $('fileStatus').classList.remove('hidden');
  }
});
