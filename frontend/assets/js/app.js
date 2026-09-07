const _isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "192.168.100.23" || location.port === "8006";
    const BACKEND_ORIGIN = _isLocal ? "" : "https://api.registrodevandalos.likay.cl";
    const API_BASE = `${BACKEND_ORIGIN}/api/politicos`;
    const API_CASES = `${BACKEND_ORIGIN}/api/casos`;
    const REGION_ORDER = ["Arica y Parinacota","Tarapacá","Antofagasta","Atacama","Coquimbo","Valparaíso","Metropolitana","O'Higgins","Maule","Ñuble","Biobío","La Araucanía","Los Ríos","Los Lagos","Aysén","Magallanes"];
    const fallback = [
      {id:"d1",nombre_completo:"Persona Demostración Norte",cargo:"Diputada",partido:"Partido de ejemplo",region:"Antofagasta",institucion:"Cámara",estado_riesgo:"sin_registros",num_eventos:0,num_empresas:2,delitos_resumen:null,eventos:[],patrimonios:[]},
      {id:"d2",nombre_completo:"Persona Demostración Centro",cargo:"Senador",partido:"Independiente",region:"Metropolitana",institucion:"Senado",estado_riesgo:"alerta_naranja",num_eventos:2,num_empresas:1,delitos_resumen:"Malversación · Cohecho",eventos:[{fecha_inicio:"2025-03-18",caso_nombre:"Revisión administrativa ficticia",estado_actual:"en_revisión",resumen:"Contenido sintético para demostrar la línea temporal.",fuente:"Fuente de demostración"}],patrimonios:[]},
      {id:"d3",nombre_completo:"Persona Demostración Costa",cargo:"Alcaldesa",partido:"Movimiento local",region:"Valparaíso",institucion:"Municipalidad",estado_riesgo:"sin_registros",num_eventos:0,num_empresas:0,delitos_resumen:null,eventos:[],patrimonios:[]},
      {id:"d4",nombre_completo:"Persona Demostración Sur",cargo:"Diputado",partido:"Partido de ejemplo",region:"Biobío",institucion:"Cámara",estado_riesgo:"alerta_roja",num_eventos:1,num_empresas:3,delitos_resumen:"Lavado de activos",eventos:[{fecha_inicio:"2024-11-02",caso_nombre:"Caso judicial ficticio",estado_actual:"formalizado",resumen:"Ejemplo sin relación con hechos o personas reales.",fuente:"Fuente de demostración"}],patrimonios:[]},
      {id:"d5",nombre_completo:"Persona Demostración Austral",cargo:"Consejera regional",partido:"Independiente",region:"Magallanes",institucion:"Gobierno regional",estado_riesgo:"alerta_naranja",num_eventos:1,num_empresas:1,delitos_resumen:"Peculado",eventos:[{fecha_inicio:"2025-09-10",caso_nombre:"Auditoría ficticia",estado_actual:"investigado",resumen:"Registro sintético de interfaz.",fuente:"Fuente de demostración"}],patrimonios:[]},
      {id:"d6",nombre_completo:"Persona Demostración Valle",cargo:"Senadora",partido:"Coalición ejemplo",region:"Maule",institucion:"Senado",estado_riesgo:"sin_registros",num_eventos:0,num_empresas:2,delitos_resumen:null,eventos:[],patrimonios:[]}
    ];

    let people = [], filtered = [], selectedRegion = null, currentView = "territory", activeFilter = "all", apiAvailable = false;    let casesData = [], filteredCases = [], caseFilters = { estado_procesal: "all", tipo_alerta: "all" };
    let graphPayload = null, somPayload = null, aliasMatches = [], aliasSearchToken = 0, funcionarios = [];
    let activeSimulation = null;
    const $ = selector => document.querySelector(selector);
    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
    const safeHref = url => /^(https?:|mailto:|tel:)/i.test(String(url || "")) ? String(url) : "#";
    const initials = name => String(name || "").split(/\s+/).filter(Boolean).map(x => x[0]).join("").replace(/[^A-Za-zÁÉÍÓÚÑÜ]/g, "").slice(0,2).toUpperCase();
    const riskGroup = p => p.estado_riesgo === "alerta_roja" ? "formal" : p.estado_riesgo === "alerta_naranja" ? "review" : "clear";
    const riskColor = p => riskGroup(p) === "formal" ? "#b94d4a" : riskGroup(p) === "review" ? "#d18a23" : "#087f73";
    const svgEl = (name, attrs={}) => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", name);
      Object.entries(attrs).forEach(([key,val]) => el.setAttribute(key,val));
      return el;
    };

    async function loadData() {
      try {
        const res = await fetch(`${API_BASE}/?limit=500`);
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) throw new Error("empty");
        people = data;
        apiAvailable = true;
        const health = await fetch(`${BACKEND_ORIGIN}/health`).then(r => r.ok ? r.json() : null).catch(() => null);
        $("#sourceStatus").textContent = health?.mode === "demo"
          ? "API conectada · datos ficticios"
          : "API conectada · datos públicos";
      } catch (err) {
        console.error("Fallo al cargar API:", err);
        people = fallback;
        $("#sourceStatus").textContent = "Modo demostración · datos ficticios";
      }
      people = people.map((p,i) => ({
        ...p,
        id: String(p.id ?? i),
        nombre_completo: p.nombre_completo || "Sin nombre",
        cargo: p.cargo || "Cargo no informado",
        partido: p.partido || "Sin partido",
        region: p.region || "Sin región",
        num_eventos: Number(p.num_eventos || 0),
        num_empresas: Number(p.num_empresas || 0),
        num_familiares: Number(p.num_familiares || 0),
        delitos_resumen: p.delitos_resumen || null
      }));
      // #13: abrir perfil directo desde la URL — recién ahora, con `people`
      // ya cargado y `apiAvailable` ya seteado, para que openProfile pueda
      // traer el detalle real en vez de mostrar el drawer vacío.
      const hashMatch = window.location.hash.match(/^#perfil\/(\d+)/);
      if (hashMatch) openProfile(parseInt(hashMatch[1]));
      if (apiAvailable) {
        const [graphResult, somResult, funcResult, casesResult] = await Promise.allSettled([
          fetch(`${BACKEND_ORIGIN}/api/politicos/grafo?limit=250`).then(r => r.ok ? r.json() : Promise.reject(r.status)),
          fetch(`${BACKEND_ORIGIN}/api/politicos/analitica/som?limit=500`).then(r => r.ok ? r.json() : Promise.reject(r.status)),
          fetch(`${BACKEND_ORIGIN}/api/funcionarios/?limit=100`).then(r => r.ok ? r.json() : Promise.reject(r.status)),
          fetch(`${API_CASES}?limit=500`).then(r => r.ok ? r.json() : Promise.reject(r.status))
        ]);
        if (graphResult.status === "fulfilled") graphPayload = graphResult.value;
        if (somResult.status === "fulfilled") somPayload = somResult.value;
        if (funcResult.status === "fulfilled") {
          funcionarios = funcResult.value.data || [];
        }
        if (casesResult.status === "fulfilled") casesData = casesResult.value || [];
      }
      updateMetrics();
      applyFilters();
    }

    function updateMetrics() {
      $("#metricPeople").textContent = people.length;
      $("#metricEvents").textContent = people.reduce((n,p)=>n+p.num_eventos,0);
      $("#metricLinks").textContent = people.reduce((n,p)=>n+p.num_empresas+p.num_familiares,0);
      $("#metricRegions").textContent = new Set(people.map(p=>p.region).filter(r=>r!=="Sin región")).size;
    }

    function applyFilters() {
      const q = $("#searchInput").value.trim().toLowerCase();
      if (currentView === "funcionarios") {
        const personList = $("#personList");
        if (personList) personList.innerHTML = "";
        renderFuncionariosList(q);
        return;
      }
      if (currentView === "cases") {
        renderCasesIntoResults();
        return;
      }
      filtered = people.filter(p => {
        const haystack = `${p.nombre_completo} ${p.partido} ${p.region} ${p.cargo}`.toLowerCase();
        return (!q || haystack.includes(q))
          && (!selectedRegion || p.region === selectedRegion)
          && (activeFilter === "all" || riskGroup(p) === activeFilter);
      });
      if (currentView === "network" || currentView === "som") {
        renderViz();
        return;
      }
      renderList();
      renderViz();
      searchAliases(q);
    }

    // Punto 3 (auditoría): buscador por alias conectado al UI.
    // Si el filtro local (nombre/partido/región/cargo) no encuentra nada
    // y hay texto de búsqueda, consulta /api/buscar/alias/ como fallback
    // ("el Tati" no aparece en nombre_completo pero sí en politicos_aliases).
    async function searchAliases(q) {
      const token = ++aliasSearchToken;
      if (!apiAvailable || !q || filtered.length) { aliasMatches = []; renderAliasHint(); return; }
      try {
        const res = await fetch(`${BACKEND_ORIGIN}/api/buscar/alias/?nombre=${encodeURIComponent(q)}`);
        if (token !== aliasSearchToken) return; // respuesta obsoleta, el usuario ya siguió escribiendo
        aliasMatches = res.ok ? await res.json() : [];
      } catch (err) {
        console.error("Fallo al buscar por alias:", err);
        aliasMatches = [];
      }
      if (token === aliasSearchToken) renderAliasHint();
    }

    function renderAliasHint() {
      const box = $("#aliasHint");
      if (!box) return;
      if (!aliasMatches.length) { box.innerHTML = ""; box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = `<div class="alias-hint-title">Encontrado por alias/apodo:</div>` + aliasMatches.map(m => `
        <button class="alias-hint-item" data-alias-person="${escapeHtml(m.politico_id)}">
          <strong>${escapeHtml(m.alias_nombre)}</strong> → ${escapeHtml(m.nombre_completo)}
          <span class="person-meta">${escapeHtml(m.alias_tipo)}${m.verificado ? " · verificado" : ""}</span>
        </button>`).join("");
      box.querySelectorAll("[data-alias-person]").forEach(btn =>
        btn.addEventListener("click", () => openProfile(btn.dataset.aliasPerson)));
    }

    function renderList() {
      $("#resultsCount").textContent = `${filtered.length} resultado${filtered.length===1?"":"s"}`;
      $("#personList").innerHTML = filtered.length ? filtered.map(p => {
        const delitosHtml = p.delitos_resumen ? `<span class="person-delitos">${escapeHtml(p.delitos_resumen)}</span>` : '';
        const avatarContent = p.foto_url
          ? `<img src="${escapeHtml(p.foto_url)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover" onerror="this.outerHTML='${escapeHtml(initials(p.nombre_completo))}'">`
          : escapeHtml(initials(p.nombre_completo));
        return `
        <button class="person" data-person="${escapeHtml(p.id)}">
          <span class="avatar">${avatarContent}</span>
          <span><span class="person-name">${escapeHtml(p.nombre_completo)}</span><span class="person-meta">${escapeHtml(p.cargo)} · ${escapeHtml(p.region)}</span>${delitosHtml}<span class="person-meta">${escapeHtml(p.num_eventos || 0)} caso(s) · ${escapeHtml(formatProcessState(p.estado_procesal_ultimo_evento || (p.estado_riesgo === "alerta_roja" ? "condenado" : p.estado_riesgo === "alerta_naranja" ? "abierto" : "sin_estado")))}</span></span>
          <span class="risk ${riskGroup(p)==="formal"?"red":riskGroup(p)==="review"?"amber":""}" title="${escapeHtml(riskGroup(p))}"></span>
        </button>`;
      }).join("") : `<div class="empty">No hay resultados con estos filtros.<br>Prueba otra región o estado.</div>`;
      document.querySelectorAll("[data-person]").forEach(btn => btn.addEventListener("click", () => openProfile(btn.dataset.person)));
    }

    function renderViz() {
      const svg = $("#vizSvg");
      const funcList = $("#funcionariosList");
      const isFuncView = currentView === "funcionarios";
      $("#viz").hidden = isFuncView;
      if (funcList) funcList.hidden = !isFuncView;
      if (isFuncView) { renderFuncionariosList($("#searchInput").value); return; }
      svg.replaceChildren();
      if (currentView === "territory") renderTerritory(svg);
      if (currentView === "network") { renderNetwork(svg); renderList(); }
      if (currentView === "som") { renderSom(svg); renderList(); }
    }

    function renderCasesIntoResults() {
      const list = $("#personList");
      const q = $("#searchInput").value.trim().toLowerCase();
      const qf = caseFilters.estado_procesal;
      let rows = casesData.slice();
      if (q) rows = rows.filter(c => `${c.nombre||""} ${c.responsable||""} ${c.delitos||""} ${c.sector||""}`.toLowerCase().includes(q));
      if (qf !== "all") rows = rows.filter(c => (c.estado_normalizado || "sin_estado") === qf);
      $("#resultsCount").textContent = `${rows.length} caso(s)`;
      list.innerHTML = rows.length ? rows.slice(0, 200).map(c => {
        const sev = c.estado_normalizado === "condenado" ? "red" : c.estado_normalizado === "abierto" ? "amber" : "";
        return `
        <button class="person person-caso" data-caso="${escapeHtml(c.id)}">
          <span class="avatar" style="background:#315aa8">${escapeHtml(initials(c.nombre||"Caso"))}</span>
          <span>
            <span class="person-name">${escapeHtml(c.nombre||"Caso sin nombre")}</span>
            <span class="person-meta">${escapeHtml(c.responsable||"Responsable no informado")}</span>
            <span class="person-meta">${escapeHtml(c.delitos||"")}${c.monto?` · Monto: ${escapeHtml(c.monto)}`:""}${c.año?` · ${escapeHtml(c.año)}`:""}</span>
          </span>
          <span class="risk ${sev}" title="${escapeHtml(c.estado||"Sin estado registrado")}"></span>
        </button>`;
      }).join("") : `<div class="empty">No hay casos con estos filtros.</div>`;
      document.querySelectorAll("[data-caso]").forEach(btn =>
        btn.addEventListener("click", () => {
          const c = casesData.find(x => String(x.id) === btn.dataset.caso);
          if (!c) return;
          $("#drawerContent").innerHTML = `
            <header class="profile-head">
              <span class="eyebrow">Caso ${escapeHtml(c.id)}</span>
              <h2 id="profileName">${escapeHtml(c.nombre||"Caso sin nombre")}</h2>
              <p>${escapeHtml(c.sector||"Sector no informado")} · ${escapeHtml(c.año||"Año no informado")}</p>
            </header>
            <div class="disclaimer">Registro público de un caso documentado. La mención de una persona como responsable no implica condena ni responsabilidad definitiva.</div>
            <section class="detail-section"><h3>Datos del caso</h3><div class="detail-grid">
              <div class="detail-stat"><b>${escapeHtml(c.estado||"—")}</b><span>Estado</span></div>
              <div class="detail-stat"><b>${escapeHtml(c.responsable||"—")}</b><span>Responsable(s)</span></div>
              <div class="detail-stat"><b>${escapeHtml(c.monto||"—")}</b><span>Monto</span></div>
              ${c.fuente_url?`<div class="detail-stat"><b><a href="${escapeHtml(safeHref(c.fuente_url))}" target="_blank" style="color:var(--teal)">Fuente</a></b><span>Documento</span></div>`:""}
            </div></section>
            ${c.delitos?`<section class="detail-section"><h3>Delitos imputados</h3><div class="delitos-tags">${c.delitos.split(",").map(d=>`<span class="delito-tag">${escapeHtml(d.trim())}</span>`).join("")}</div></section>`:""}
            <p style="color:var(--muted);font-size:11px;margin-top:14px">Código de caso ${escapeHtml(c.id)} · Fuente base de corrupción Chile compilada públicamente.</p>`;
          $("#drawerBackdrop").classList.add("open");
          $("#drawerClose").focus();
        }));
    }

    function renderFuncionariosList(q) {
      const list = $("#funcionariosList");
      const query = (q || "").trim().toLowerCase();
      let rows = funcionarios || [];
      if (query) {
        rows = rows.filter(f =>
          `${f.nombre_completo||""} ${f.cargo||""} ${f.institucion||""} ${f.dependencia_jerarquica||""}`.toLowerCase().includes(query));
      }
      if (!rows.length) {
        list.innerHTML = `<div class="empty">${funcionarios && funcionarios.length ? "Sin funcionarios con esos criterios." : "Sin funcionarios registrados"}</div>`;
        return;
      }
      list.innerHTML = rows.map(f => `
        <button class="person person-funcionario" data-funcionario="${f.id}">
          <span class="avatar" style="background:#315aa8">${escapeHtml(initials(f.nombre_completo))}</span>
          <span>
            <span class="person-name">${escapeHtml(f.nombre_completo)}</span>
            <span class="person-meta">${escapeHtml(f.cargo)} · ${escapeHtml(f.institucion)}</span>
            <span class="person-meta">${escapeHtml(f.dependencia_jerarquica || "—")}</span>
          </span>
          <span class="badge-funcionario" title="Funcionario de Gobierno">FG</span>
        </button>`).join("");
      document.querySelectorAll("[data-funcionario]").forEach(btn =>
        btn.addEventListener("click", () => openFuncionario(btn.dataset.funcionario)));
    }

    async function openFuncionario(id) {
      if (!apiAvailable) return;
      try {
        const res = await fetch(`${BACKEND_ORIGIN}/api/funcionarios/${id}`);
        if (!res.ok) return;
        const f = await res.json();
        const eventos = f.casos_propios?.length ? f.casos_propios : f.casos_menciones || [];
        const stateClass = eventos.length ? "open" : "closed";
        $("#drawerContent").innerHTML = `
          <header class="profile-head">
            <span class="eyebrow">${escapeHtml(f.institucion)}</span>
            <h2 id="profileName">${escapeHtml(f.nombre_completo)}</h2>
            <p>${escapeHtml(f.cargo)} · Designación: ${escapeHtml(f.fecha_designacion || "—")}</p>
          </header>
          <div class="disclaimer">Este registro documenta a un funcionario designado, no electo. Puede tener vínculos con políticos si la fuente lo documenta.</div>
          <section class="detail-section"><h3>Datos de designación</h3><div class="detail-grid">
            <div class="detail-stat"><b>${escapeHtml(f.institucion)}</b><span>Institución</span></div>
            <div class="detail-stat"><b>${escapeHtml(f.cargo)}</b><span>Cargo</span></div>
            <div class="detail-stat"><b>${escapeHtml(f.fecha_designacion || "—")}</b><span>Fecha designación</span></div>
            <div class="detail-stat"><b>${(f.familiares?.length || 0)}</b><span>Familiares registrados</span></div>
          </div></section>
          ${eventos.length ? `<section class="detail-section"><h3>Antecedentes relacionados</h3>${eventos.map(e => `
            <article class="event">
              <time>${escapeHtml(e.fecha_inicio || "—")}</time>
              <strong>${escapeHtml(e.caso_nombre || "Antecedente")}</strong>
              <p>${escapeHtml(e.resumen || "Sin resumen.")}</p>
              <b>Fuente:</b> ${escapeHtml(e.fuente || "—")}
            </article>`).join("")}</section>` : '<div class="empty">No hay antecedentes registrados.</div>'}
          ${f.familiares?.length ? `<section class="detail-section"><h3>Familiares</h3>${f.familiares.map(fam => `
            <article class="event">
              <strong>${escapeHtml(fam.nombre_completo)}</strong>
              <p>${escapeHtml(fam.parentesco || "—")}</p>
            </article>`).join("")}</section>` : ''}
          ${f.fuente_url ? `<p style="margin-top:24px;font-size:12px;color:var(--muted)">Fuente: <a href="${escapeHtml(safeHref(f.fuente_url))}" target="_blank" style="color:var(--teal)">${escapeHtml(f.fuente_url)}</a></p>` : ''}
        `;
        $("#drawerBackdrop").classList.add("open");
        $("#drawerClose").focus();
      } catch (err) {
        console.error("Error cargando funcionario:", err);
      }
    }

    function renderTerritory(svg) {
      const counts = new Map(REGION_ORDER.map(r => [r, people.filter(p=>p.region===r).length]));
      const max = Math.max(1,...counts.values());
      const group = svgEl("g",{transform:"translate(315 24)"});
      const center = 80;
      REGION_ORDER.forEach((region,i) => {
        const y = i*27 + 4;
        const count = counts.get(region);
        const width = 18 + (count/max)*68;
        const drift = Math.sin(i*.92)*18;
        const path = svgEl("path",{
          d:`M ${center+drift-width/2} ${y} Q ${center+drift} ${y-5} ${center+drift+width/2} ${y} L ${center+drift+width/2-3} ${y+17} Q ${center+drift} ${y+23} ${center+drift-width/2+3} ${y+17} Z`,
          fill:selectedRegion===region?"#087f73":"#d9eeea",
          stroke:selectedRegion===region?"#087f73":"#9fcac3",
          "stroke-width":"1", tabindex:"0", role:"button", "aria-label":`${region}: ${count} autoridades`
        });
        path.style.cursor = "pointer";
        path.addEventListener("click",()=>{selectedRegion=selectedRegion===region?null:region;applyFilters();});
        bindTooltip(path, `${region} · ${count} registro${count===1?"":"s"}`);
        group.append(path);
        if (i%2===0 || count>0) {
          const text = svgEl("text",{x:center+125,y:y+14,fill:"#66716d","font-size":"10","font-family":"DM Mono"});
          text.textContent = region;
          group.append(text);
        }
      });
      svg.append(group);
      const title = svgEl("text",{x:"42",y:"88",fill:"#17211f","font-size":"25","font-family":"Newsreader"});
      title.textContent = selectedRegion || "Chile";
      svg.append(title);
      const sub = svgEl("text",{x:"42",y:"111",fill:"#66716d","font-size":"10","font-family":"DM Mono"});
      sub.textContent = selectedRegion ? "SELECCIÓN ACTIVA · CLIC PARA LIMPIAR" : "16 REGIONES · EJE NORTE A SUR";
      svg.append(sub);
    }

    function renderNetwork(svg) {
      if (graphPayload?.nodes?.length) {
        renderApiNetwork(svg);
        return;
      }
      const nodes = filtered.slice(0,18);
      const cx=400, cy=250, radius=180;
      const positions = nodes.map((p,i)=>({p,x:cx+Math.cos(i/nodes.length*Math.PI*2)*radius*(.78+(i%3)*.1),y:cy+Math.sin(i/nodes.length*Math.PI*2)*radius*(.72+(i%2)*.18)}));
      const hubs = [
        {name:"Casos",x:400,y:165,color:"#d18a23"},
        {name:"Empresas",x:330,y:300,color:"#315aa8"},
        {name:"Familiares",x:480,y:310,color:"#6b5b8e"}
      ];
      positions.forEach(({p,x,y},i)=>{
        const hub = hubs[i%3];
        const line=svgEl("line",{x1:x,y1:y,x2:hub.x,y2:hub.y,stroke:"#cbd4cf","stroke-width":Math.max(1,Math.min(4,p.num_eventos+p.num_empresas))});
        svg.append(line);
      });
      hubs.forEach(h=>{
        const c=svgEl("circle",{cx:h.x,cy:h.y,r:"36",fill:h.color,opacity:".92"});
        const t=svgEl("text",{x:h.x,y:h.y+4,"text-anchor":"middle",fill:"white","font-size":"10","font-family":"DM Mono"});
        t.textContent=h.name; svg.append(c,t);
      });
      positions.forEach(({p,x,y})=>{
        const g=svgEl("g",{tabindex:"0",role:"button"}); g.style.cursor="pointer";
        const c=svgEl("circle",{cx:x,cy:y,r:13+Math.min(8,p.num_eventos*2),fill:riskColor(p),stroke:"#fff","stroke-width":"3"});
        const t=svgEl("text",{x,y:y+30,"text-anchor":"middle",fill:"#17211f","font-size":"9","font-family":"Manrope"});
        t.textContent=p.nombre_completo.split(" ").slice(0,2).join(" ");
        g.append(c,t); g.addEventListener("click",()=>openProfile(p.id)); bindTooltip(g,`${p.nombre_completo} · ${p.num_eventos} antecedentes · ${formatProcessState(p.estado_procesal_ultimo_evento || (p.estado_riesgo === "alerta_roja" ? "condenado" : p.estado_riesgo === "alerta_naranja" ? "abierto" : "sin_estado"))}`); svg.append(g);
      });
    }

    function renderApiNetwork(svg) {
      if (typeof d3 === 'undefined') {
        renderApiNetworkStatic(svg);
        return;
      }
      
      const container = svg.parentElement;
      container.innerHTML = '<div class="d3-graph-container" id="d3graph"></div>';
      const graphDiv = container.querySelector('#d3graph');
      
      const width = container.clientWidth;
      const height = container.clientHeight;
      
      const svgD3 = d3.select(graphDiv)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', `0 0 ${width} ${height}`);
      
      // Zoom/Pan
      const g = svgD3.append('g');
      
      svgD3.call(d3.zoom()
        .scaleExtent([0.2, 5])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
        }));
      
      // Preparar datos
      const selectedPeople = new Set(filtered.map(p => `politico:${p.id}`));
      const visibleEdges = graphPayload.edges.filter(edge =>
        selectedPeople.has(edge.origen) || selectedPeople.has(edge.destino)
      );
      const visibleIds = new Set([...selectedPeople]);
      visibleEdges.forEach(edge => { visibleIds.add(edge.origen); visibleIds.add(edge.destino); });
      
      const typeConfig = {
        politico: { color: '#087f73', radius: 18 },
        evento: { color: '#d18a23', radius: 12 },
        empresa: { color: '#315aa8', radius: 12 },
        familiar: { color: '#6b5b8e', radius: 11 }
      };
      
      let nodes = graphPayload.nodes
        .filter(node => visibleIds.has(node.id))
        .slice(0, 100)
        .map(node => {
          const cfg = typeConfig[node.tipo] || typeConfig.empresa;
          const esPol = node.tipo === 'politico';
          const polId = esPol ? node.id.replace('politico:', '') : null;
          const polData = esPol ? filtered.find(p => String(p.id) === polId) : null;
          return {
            id: node.id,
            tipo: node.tipo,
            nombre: node.etiqueta,
            color: esPol && polData ? riskColor(polData) : cfg.color,
            radius: esPol ? cfg.radius + Math.min(8, (polData?.num_eventos || 0) * 1.5) : cfg.radius,
            num_eventos: polData?.num_eventos || 0,
            estado: polData?.estado_riesgo || node.metadata?.estado || 'sin_estado'
          };
        });
      
      const allowed = new Set(nodes.map(n => n.id));
      const edges = visibleEdges
        .filter(e => allowed.has(e.origen) && allowed.has(e.destino))
        .map(e => ({ source: e.origen, target: e.destino, tipo: e.tipo }));
      
      // Force simulation
      if (activeSimulation) activeSimulation.stop();
      const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges).id(d => d.id).distance(80).strength(0.5))
        .force('charge', d3.forceManyBody().strength(-200))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => d.radius + 5));
      activeSimulation = simulation;
      
      // Dibujar aristas — vínculos mediáticos (mención conjunta, sin confirmar)
      // se ven punteados y tenues; verificados (familiar, negocios, etc.) sólidos.
      const link = g.append('g')
        .selectAll('line')
        .data(edges)
        .enter()
        .append('line')
        .attr('class', 'd3-link')
        .attr('stroke', d => d.tipo === 'mediatico' ? '#c4cec8' : '#8a7ab0')
        .attr('stroke-width', d => d.tipo === 'mediatico' ? 0.8 : 1.6)
        .attr('stroke-opacity', d => d.tipo === 'mediatico' ? 0.35 : 0.85)
        .attr('stroke-dasharray', d => d.tipo === 'mediatico' ? '2,3' : null);
      
      // Dibujar nodos
      const node = g.append('g')
        .selectAll('g')
        .data(nodes)
        .enter()
        .append('g')
        .attr('class', 'd3-node')
        .call(d3.drag()
          .on('start', dragstarted)
          .on('drag', dragged)
          .on('end', dragended));
      
      node.append('circle')
        .attr('r', d => d.radius)
        .attr('fill', d => d.color)
        .attr('stroke', 'white')
        .attr('stroke-width', 2.5);
      
      node.append('title').text(d => `${d.nombre} · ${d.tipo} · ${d.num_eventos} eventos`);
      
      // Labels solo para políticos
      node.filter(d => d.tipo === 'politico')
        .append('text')
        .attr('class', 'd3-label')
        .attr('text-anchor', 'middle')
        .attr('dy', d => d.radius + 12)
        .text(d => d.nombre.split(' ').slice(0, 2).join(' '));
      
      // Click en políticos — solo abre el drawer, sin destruir el grafo
      node.filter(d => d.tipo === 'politico')
        .on('click', (event, d) => {
          event.stopPropagation();
          const polId = d.id.replace('politico:', '');
          openProfile(parseInt(polId));
        });
      
      // Hover tooltip
      node.on('mouseover', function(event, d) {
        d3.select(this).select('circle').attr('stroke-width', 4);
      }).on('mouseout', function() {
        d3.select(this).select('circle').attr('stroke-width', 2.5);
      });
      
      // Tick
      simulation.on('tick', () => {
        link
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);
        
        node.attr('transform', d => `translate(${d.x},${d.y})`);
      });
      
      function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      }
      function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
      }
      function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }
      
      // Leyenda
      const legendData = [
        { label: 'Político', color: '#087f73' },
        { label: 'Caso', color: '#d18a23' },
        { label: 'Empresa', color: '#315aa8' },
        { label: 'Familiar', color: '#6b5b8e' }
      ];
      
      const legend = svgD3.append('g').attr('transform', `translate(15, ${height - 80})`);
      legendData.forEach((item, i) => {
        const lg = legend.append('g').attr('transform', `translate(0, ${i * 16})`);
        lg.append('circle').attr('cx', 5).attr('cy', 5).attr('r', 5).attr('fill', item.color);
        lg.append('text').attr('x', 14).attr('y', 8).attr('font-size', 9).attr('font-family', 'DM Mono').attr('fill', '#66716d').text(item.label);
      });

      // Aclaración del estilo de línea: sólido = verificado, punteado = solo mediático
      const lineLegend = legend.append('g').attr('transform', `translate(110, 0)`);
      lineLegend.append('line').attr('x1', 0).attr('y1', 5).attr('x2', 18).attr('y2', 5).attr('stroke', '#8a7ab0').attr('stroke-width', 1.6);
      lineLegend.append('text').attr('x', 24).attr('y', 8).attr('font-size', 9).attr('font-family', 'DM Mono').attr('fill', '#66716d').text('Vínculo verificado');
      lineLegend.append('line').attr('x1', 0).attr('y1', 21).attr('x2', 18).attr('y2', 21).attr('stroke', '#c4cec8').attr('stroke-width', 0.8).attr('stroke-dasharray', '2,3');
      lineLegend.append('text').attr('x', 24).attr('y', 24).attr('font-size', 9).attr('font-family', 'DM Mono').attr('fill', '#66716d').text('Solo mención en prensa');
    }
    
    function renderApiNetworkStatic(svg) {
      const selectedPeople = new Set(filtered.map(p => `politico:${p.id}`));
      const visibleEdges = graphPayload.edges.filter(edge =>
        selectedPeople.has(edge.origen) || selectedPeople.has(edge.destino)
      );
      const visibleIds = new Set([...selectedPeople]);
      visibleEdges.forEach(edge => { visibleIds.add(edge.origen); visibleIds.add(edge.destino); });
      const nodes = graphPayload.nodes.filter(node => visibleIds.has(node.id)).slice(0, 70);
      const allowed = new Set(nodes.map(node => node.id));
      const edges = visibleEdges.filter(edge => allowed.has(edge.origen) && allowed.has(edge.destino));
      const typeConfig = {
        politico: {color:"#087f73", radius:15, ring:185},
        evento: {color:"#d18a23", radius:11, ring:115},
        empresa: {color:"#315aa8", radius:11, ring:120},
        familiar: {color:"#6b5b8e", radius:10, ring:115}
      };
      const positions = new Map();
      const byType = Object.groupBy ? Object.groupBy(nodes, n => n.tipo) : nodes.reduce((a,n)=>((a[n.tipo]??=[]).push(n),a),{});
      Object.entries(byType).forEach(([type, group], typeIndex) => {
        const cfg = typeConfig[type] || typeConfig.empresa;
        group.forEach((node,index) => {
          const angle = (index / Math.max(1, group.length)) * Math.PI * 2 + typeIndex * .55;
          const ring = cfg.ring + typeIndex * 13;
          positions.set(node.id, {
            x: 400 + Math.cos(angle) * ring,
            y: 250 + Math.sin(angle) * ring * .88
          });
        });
      });
      edges.forEach(edge => {
        const from=positions.get(edge.origen), to=positions.get(edge.destino);
        if(!from||!to)return;
        // Vínculos mediáticos (mención conjunta en noticias, sin confirmar) se muestran
        // punteados y tenues; vínculos verificados (familiar, negocios, etc.) sólidos.
        const isMediatico = edge.tipo === "mediatico";
        svg.append(svgEl("line",{
          x1:from.x,y1:from.y,x2:to.x,y2:to.y,
          stroke: isMediatico ? "#c4cec8" : "#8a7ab0",
          "stroke-width": isMediatico ? "0.8" : "1.6",
          "stroke-opacity": isMediatico ? ".35" : ".85",
          ...(isMediatico ? {"stroke-dasharray":"2,3"} : {})
        }));
      });
      nodes.forEach(node => {
        const pos=positions.get(node.id), cfg=typeConfig[node.tipo]||typeConfig.empresa;
        const g=svgEl("g",{tabindex:"0",role:"button"}); g.style.cursor="pointer";
        g.append(svgEl("circle",{cx:pos.x,cy:pos.y,r:cfg.radius,fill:cfg.color,stroke:"white","stroke-width":"3"}));
        if(node.tipo==="politico"){
          const label=svgEl("text",{x:pos.x,y:pos.y+28,"text-anchor":"middle",fill:"#17211f","font-size":"9","font-family":"Manrope"});
          label.textContent=node.etiqueta.split(" ").slice(0,2).join(" "); g.append(label);
          g.addEventListener("click",()=>openProfile(node.id.replace("politico:","")));
        }
        bindTooltip(g,`${node.etiqueta} · ${node.tipo} · ${formatProcessState(node.metadata?.estado || (node.tipo === "evento" ? "abierto" : "sin_estado"))}`);
        svg.append(g);
      });
    }

    function renderSom(svg) {
      const cols=8, rows=5, cellW=88, cellH=78, ox=48, oy=55;
      const palette=["#d7ebe7","#c5e1dc","#e9ddc2","#e6cfa4","#d9ddea","#c9d2e7"];
      for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) {
        const score=(Math.sin(c*.8+r*1.3)+1)/2;
        const rect=svgEl("rect",{x:ox+c*cellW,y:oy+r*cellH,width:cellW-4,height:cellH-4,rx:"10",fill:palette[Math.floor(score*(palette.length-1))],opacity:".8"});
        svg.append(rect);
      }
      const apiItems = somPayload?.items?.filter(item => filtered.some(p => p.id === String(item.politico_id)));
      const assignments = apiItems?.length ? trainSom(apiItems, cols, rows) : null;
      filtered.forEach((p,i)=>{
        const assigned = assignments?.get(p.id);
        const features=(p.num_eventos*7+p.num_empresas*3+p.nombre_completo.length+i*5);
        const c=assigned?.c ?? features%cols, r=assigned?.r ?? Math.floor((features/cols)%rows);
        const x=ox+c*cellW+20+(i%3)*18, y=oy+r*cellH+22+(i%2)*24;
        const node=svgEl("circle",{cx:x,cy:y,r:10,fill:riskColor(p),stroke:"white","stroke-width":"3",tabindex:"0",role:"button"});
        node.style.cursor="pointer"; node.addEventListener("click",()=>openProfile(p.id));
        bindTooltip(node,`${p.nombre_completo} · ${formatProcessState(p.estado_procesal_ultimo_evento || (p.estado_riesgo === "alerta_roja" ? "condenado" : p.estado_riesgo === "alerta_naranja" ? "abierto" : "sin_estado"))} · vecino por similitud estadística`);
        svg.append(node);
      });
      const xLabel=svgEl("text",{x:"400",y:"478","text-anchor":"middle",fill:"#66716d","font-size":"10","font-family":"DM Mono"});
      xLabel.textContent=" MENOS VÍNCULOS DECLARADOS · MÁS VÍNCULOS DECLARADOS "; svg.append(xLabel);
    }

    function trainSom(items, cols, rows) {
      const dimensions=items[0]?.normalized?.length||0;
      const neurons=Array.from({length:cols*rows},(_,index)=>({
        c:index%cols,
        r:Math.floor(index/cols),
        w:Array.from({length:dimensions},(_,d)=>(Math.sin((index+1)*(d+2)*1.7)+1)/2)
      }));
      for(let epoch=0;epoch<70;epoch++){
        const learning=.48*(1-epoch/70)+.04;
        const radius=Math.max(.7,3.4*(1-epoch/70));
        items.forEach(item=>{
          const best=neurons.reduce((winner,n)=>{
            const distance=n.w.reduce((sum,w,d)=>sum+(w-item.normalized[d])**2,0);
            return !winner||distance<winner.distance?{n,distance}:winner;
          },null).n;
          neurons.forEach(n=>{
            const gridDistance=Math.hypot(n.c-best.c,n.r-best.r);
            if(gridDistance>radius)return;
            const influence=Math.exp(-(gridDistance**2)/(2*radius**2));
            n.w=n.w.map((w,d)=>w+learning*influence*(item.normalized[d]-w));
          });
        });
      }
      return new Map(items.map(item=>{
        const best=neurons.reduce((winner,n)=>{
          const distance=n.w.reduce((sum,w,d)=>sum+(w-item.normalized[d])**2,0);
          return !winner||distance<winner.distance?{n,distance}:winner;
        },null).n;
        return [String(item.politico_id),{c:best.c,r:best.r}];
      }));
    }

    function bindTooltip(el,text) {
      el.addEventListener("pointerenter",()=>{$("#tooltip").textContent=text;$("#tooltip").classList.add("show");});
      el.addEventListener("pointermove",e=>{$("#tooltip").style.left=`${e.clientX+12}px`;$("#tooltip").style.top=`${e.clientY+12}px`;});
      el.addEventListener("pointerleave",()=>$("#tooltip").classList.remove("show"));
    }

    function formatProcessState(value) {
      switch (String(value || "").toLowerCase()) {
        case "abierto":
          return "Investigación en curso";
        case "cerrado_sin_condena":
          return "Cerrado sin condena";
        case "condenado":
          return "Condenado";
        case "sin_estado":
          return "Sin antecedentes";
        default:
          return "Otro";
      }
    }

    const avatarHtml = (p, size) => {
      const s = size || 64;
      if (p.foto_url) return `<img src="${escapeHtml(p.foto_url)}" alt="${escapeHtml(p.nombre_completo)}" style="width:${s}px;height:${s}px;border-radius:50%;object-fit:cover;border:2px solid var(--teal)" onerror="this.outerHTML='<span class=\\'avatar-fallback\\' style=\\'width:${s}px;height:${s}px\\'>${escapeHtml(initials(p.nombre_completo))}</span>'">`;
      return `<span class="avatar-fallback" style="width:${s}px;height:${s}px">${escapeHtml(initials(p.nombre_completo))}</span>`;
    };

    async function openProfile(id) {
      // #13: Actualizar URL hash para perfil individual (evita apilar historial innecesario)
      if (id && window.location.hash !== `#perfil/${id}`) {
        history.pushState(null, '', `#perfil/${id}`);
      }
      let p=people.find(x=>x.id===String(id));
      if(apiAvailable){
        try {
          const res=await fetch(`${API_BASE}/${encodeURIComponent(id)}`);
          if(res.ok) p={...p,...await res.json()};
        } catch (err) { console.error("Fallo al cargar detalle del político:", err); }
      }
      if(!p)return;
      const events=p.eventos||[];
      const companyCount=(p.patrimonios||[]).reduce((n,x)=>n+(x.empresas||[]).length,0)||p.num_empresas||0;
      const _severidad = { condenado: 3, abierto: 2, cerrado_sin_condena: 1, sin_estado: 0 };
      const processState = events.reduce((peor, e) => {
        const s = e.estado_normalizado || "sin_estado";
        return (_severidad[s] ?? 0) > (_severidad[peor] ?? 0) ? s : peor;
      }, "sin_estado");
      const stateClass = processState === "condenado" ? "convicted" : processState === "cerrado_sin_condena" ? "closed" : "open";
      $("#drawerContent").innerHTML=`
        <header class="profile-head">
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">
            ${avatarHtml(p, 64)}
            <div>
              <span class="eyebrow">${escapeHtml(p.institucion||"Registro público")}</span>
              <h2 id="profileName">${escapeHtml(p.nombre_completo)}</h2>
              <p>${escapeHtml(p.cargo)} · ${escapeHtml(p.partido)} · ${escapeHtml(p.region)}</p>
            </div>
          </div>
        </header>
        <div class="disclaimer">Los antecedentes describen estados documentales y procesales. No constituyen una declaración de culpabilidad. Verifica siempre la fuente y su fecha.</div>
        <section class="detail-section"><h3>Resumen registrado</h3><div class="detail-grid">
          <div class="detail-stat"><b>${events.length||p.num_eventos||0}</b><span>antecedentes</span></div>
          <div class="detail-stat"><b>${companyCount}</b><span>empresas</span></div>
          <div class="detail-stat"><b>${escapeHtml(p.familiares?.length||0)}</b><span>familiares</span></div>
        </div></section>
        <div class="state-badge ${stateClass}">
          <span>Último estado procesal:</span>
          <strong>${escapeHtml(formatProcessState(processState))}</strong>
        </div>
        ${p.delitos_resumen ? `<section class="detail-section"><h3>Problemas legales</h3><div class="delitos-tags">${p.delitos_resumen.split(' · ').map(d => `<span class="delito-tag">${escapeHtml(d)}</span>`).join('')}</div></section>` : ''}
        <section class="detail-section"><h3>📅 Timeline de casos</h3>
          <div class="timeline-container" id="timelineContainer">
            ${events.length > 1 ? `
              <div class="timeline-track"></div>
              ${[...events].sort((a,b) => (parseInt(a.fecha_inicio) || 9999) - (parseInt(b.fecha_inicio) || 9999)).map((e, idx, arr) => {
                const state = e.estado_normalizado === "cerrado_sin_condena" ? "closed" : e.estado_normalizado === "abierto" ? "open" : e.estado_normalizado === "condenado" ? "convicted" : "no-date";
                const title = e.caso_nombre || "Caso sin nombre";
                const year = e.fecha_inicio || "—";
                const pos = arr.length > 1 ? (idx / (arr.length - 1)) * 90 + 5 : 50;
                return `<div class="timeline-event ${state}" style="left: ${pos}%" title="${escapeHtml(title)}"><span class="timeline-tooltip">${escapeHtml(title)} · ${escapeHtml(String(year))}</span></div>`;
              }).join("")}
            ` : `<div class="empty">No hay casos suficientes para mostrar timeline.</div>`}
          </div>
        </section>
        <section class="detail-section"><h3>Cronología detallada</h3>
          ${events.length?events.map(e=>{
            const processState = e.estado_normalizado || "sin_estado";
            const badgeClass = processState==="condenado"?"convicted":processState==="cerrado_sin_condena"?"closed":"open";
            return `<article class="event"><time>${escapeHtml(e.fecha_inicio||"Fecha no informada")}</time><strong>${escapeHtml(e.caso_nombre||"Antecedente")}</strong>${e.delitos?`<p>Delitos: ${escapeHtml(e.delitos)}</p>`:""}<p>${escapeHtml(e.resumen||"Sin resumen.")}</p>${e.conclusion?`<p><b>Conclusión:</b> ${escapeHtml(e.conclusion)}</p>`:""}<p><b>Estado:</b> ${escapeHtml(e.estado_actual||"no informado")} · <b>Fuente:</b> ${escapeHtml(e.fuente||"no informada")}</p><div class="state-badge ${badgeClass}"><span>Lectura metodológica:</span><strong>${escapeHtml(formatProcessState(processState))}</strong></div></article>`;
          }).join(""):`<div class="empty">No existen antecedentes asociados en la base actual.</div>`}
        </section>
        <section class="detail-section"><h3>Noticias relacionadas</h3>
          ${p.noticias && p.noticias.length ? p.noticias.map(n => `
            <article class="event">
              <time>${escapeHtml(n.fecha_publicacion || "—")}</time>
              <strong>${escapeHtml(n.titulo)}</strong>
              <p>🔗 <a href="${escapeHtml(safeHref(n.url))}" target="_blank" style="color:var(--teal)">Ver en ${escapeHtml(n.fuente)}</a></p>
              <p>📰 Fuente: ${escapeHtml(n.fuente)}</p>
            </article>`).join("") : `<div class="empty">Sin noticias registradas.</div>`}
        </section>
          ${(p.familiares&&p.familiares.length)?p.familiares.map(f=>{
            const casos=f.casos||[];
            const flag=casos.length?`<div class="state-badge convicted" style="margin-top:6px"><span>⚠ Vínculo con antecedentes</span><strong>${casos.length} caso(s) registrado(s) a nombre de esta persona</strong></div>`:"";
            return `<article class="event"><strong>${escapeHtml(f.nombre_completo)}</strong><p>${escapeHtml(f.parentesco||"vínculo no especificado")}${f.notas?` · ${escapeHtml(f.notas)}`:""}</p>${flag}</article>`;
          }).join(""):`<div class="empty">Sin familiares registrados en la base actual.</div>`}
          ${(p.aliases&&p.aliases.length)?`<div class="detail-grid" style="margin-top:10px">${p.aliases.map(a=>`<div class="detail-stat"><b>${escapeHtml(a.alias_nombre)}</b><span>${escapeHtml(a.alias_tipo)}${a.verificado?" · verificado":""}</span></div>`).join("")}</div>`:""}
        </section>
        <section class="detail-section"><h3>Rectificación</h3><p style="color:var(--muted);font-size:11px;line-height:1.6">Si un registro está desactualizado o requiere contexto, solicita revisión indicando la fuente y el antecedente correspondiente.</p></section>`;
      $("#drawerBackdrop").classList.add("open");
      $("#drawerClose").focus();
    }

    const viewText={
      territory:{eyebrow:"Lectura territorial",title:'El poder deja una <em>trama.</em>',copy:"Explora autoridades, antecedentes públicos y conexiones declaradas sin perder de vista el territorio ni el estado de cada fuente.",note:"Selecciona una región de la columna chilena. El tamaño de cada marca resume la cantidad de autoridades registradas, no su nivel de riesgo.",panel:"Autoridades por territorio",panelEye:"Chile longitudinal",hint:"Pasa el cursor sobre una región y selecciónala para filtrar la lista."},
      network:{eyebrow:"Relaciones declaradas",title:'Ningún registro existe <em>aislado.</em>',copy:"Observa cómo autoridades, empresas, familiares y antecedentes comparten una red de vínculos explícitos y verificables.",note:"Cada línea representa una relación registrada. Su proximidad visual no implica coordinación, asociación ilícita ni responsabilidad compartida.",panel:"Grafo de relaciones",panelEye:"Vínculos explícitos",hint:"Selecciona un nodo para abrir su ficha. El grosor resume vínculos registrados."},
      som:{eyebrow:"Exploración estadística",title:'Parecidos no significa <em>relacionados.</em>',copy:"El mapa autoorganizado agrupa perfiles con variables similares para descubrir patrones que una lista tradicional no muestra.",note:"El SOM es exploratorio: la cercanía indica similitud matemática entre atributos, no parentesco, colaboración ni culpabilidad.",panel:"Mapa de similitudes",panelEye:"SOM exploratorio",hint:"Cada celda agrupa perfiles parecidos. Selecciona un punto para entender sus datos originales."},
      funcionarios:{eyebrow:"Funcionarios de Gobierno",title:'Quién <em>administra</em> el Estado',copy:"Identifica a personas que trabajan para el gobierno como funcionarios públicos, separadas de políticos electos.",note:"Los funcionarios son designados, no electos. Pueden tener vínculos con políticos si la fuente lo documenta.",panel:"Funcionarios registrados",panelEye:"Designación pública",hint:"Usa el filtro para distinguir entre políticos electos y funcionarios de gobierno."},
      cases:{eyebrow:"Casos documentados",title:'Casos de <em>corrupción.</em>',copy:"Explora los casos documentados y sus responsables, independientemente de ser o no autoridad electa.",note:"Cada caso es un registro público. La mención de un responsable no implica condena ni responsabilidad definitiva.",panel:"Casos de corrupción",panelEye:"Compilación pública",hint:"Busca por nombre, responsable o delito. Selecciona un caso para abrir su ficha."}
    };

    document.querySelectorAll(".nav button").forEach(btn=>btn.addEventListener("click",()=>{
      currentView=btn.dataset.view; selectedRegion=null;
      document.querySelectorAll(".nav button").forEach(x=>x.classList.toggle("active",x===btn));
      const v=viewText[currentView];
      $("#viewEyebrow").textContent=v.eyebrow; $("#viewTitle").innerHTML=v.title; $("#viewCopy").textContent=v.copy;
      $("#viewNote").innerHTML=`<strong>Cómo leer esta vista</strong>${escapeHtml(v.note)}`;
      $("#panelTitle").textContent=v.panel; $("#panelEyebrow").textContent=v.panelEye; $("#vizHint").textContent=v.hint;
      const vizPanel = $("#viz");
      const funcList = $("#funcionariosList");
      const caseFilterEl = $("#caseStateFilter");
      const peopleFilters = $("#filters");
      if (currentView === "cases" || currentView === "funcionarios") {
        vizPanel.hidden = true;
        if (funcList) funcList.hidden = currentView !== "funcionarios";
        if (caseFilterEl) caseFilterEl.hidden = currentView !== "cases";
        if (peopleFilters) peopleFilters.hidden = currentView !== "cases";
      } else {
        if (vizPanel.hidden) vizPanel.hidden = false;
        if (funcList) funcList.hidden = true;
        if (caseFilterEl) caseFilterEl.hidden = true;
        if (peopleFilters) peopleFilters.hidden = false;
      }
      applyFilters();
    }));
    document.querySelectorAll(".chip").forEach(btn=>btn.addEventListener("click",()=>{
      activeFilter=btn.dataset.filter; document.querySelectorAll(".chip").forEach(x=>x.classList.toggle("active",x===btn)); applyFilters();
    }));
    $("#caseStateFilter").addEventListener("change", e => {
      caseFilters.estado_procesal = e.target.value;
      applyFilters();
    });
    let searchTimer;
    $("#searchInput").addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilters, 200);
    });
    document.addEventListener("click",e=>{
      if(!e.target.closest(".search")) { const box=$("#aliasHint"); if(box) box.hidden = true; }
    });
    $("#drawerClose").addEventListener("click",()=>$("#drawerBackdrop").classList.remove("open"));
    $("#drawerBackdrop").addEventListener("click",e=>{if(e.target===e.currentTarget)e.currentTarget.classList.remove("open");});
    document.addEventListener("keydown",e=>{if(e.key==="Escape")$("#drawerBackdrop").classList.remove("open");});
    loadData();