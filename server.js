'use strict';

const express = require('express');
const sql     = require('mssql');
const fs      = require('fs');
const path    = require('path');

// ─── Password SQL ─────────────────────────────────────────────────────────────
const SQL_PASS = process.env.SQL_PASS ||
  (() => { try { return fs.readFileSync(path.join(__dirname, 'SQL_PASS.txt'), 'utf8').trim(); } catch { return 'DHsql1234'; } })();

// ─── Password Dashboard ───────────────────────────────────────────────────────
const DASHBOARD_PASS = process.env.DASHBOARD_PASS || 'dh2026';

// ─── Conexión ─────────────────────────────────────────────────────────────────
const sqlConfig = {
  server:   'mc100.dos-hermanos.com',
  port:     1433,
  database: 'backupBaseDeDatos',
  user:     'usuario',
  password: SQL_PASS,
  options:  { encrypt: false, trustServerCertificate: true }
};

let pool;
async function getPool() {
  if (!pool) pool = await sql.connect(sqlConfig);
  return pool;
}


// ─── Rubros: dim = Dimensionvalor en DHControlPresup ─────────────────────────
// vol = clave interna usada para buscar en el índice de volúmenes
const RUBRO_CFG = {
  'MOLINO':                 { tab: 'VA',  label: 'Molienda',         vol: 'MOLINO_CASC' },
  'ENVASADORA':             { tab: 'VA',  label: 'Elaborado',         vol: 'ENVASADO'   },
  'PLANTA PARBOIL':         { tab: 'VA',  label: 'Parboil',           vol: 'PARBOIL'    },
  'MOLINO HARINA':          { tab: 'VA',  label: 'Harina',            vol: 'HARINA'     },
  'DEPOSITOS DE ARROZ':     { tab: 'VA',  label: 'Depósito',          vol: 'MOLINO_CASC' },
  'GALLETAS SLIM':          { tab: 'INF', label: 'SLIM',              vol: 'SLIM'       },
  'EXTRUSADO 2 (Snacks)':   { tab: 'INF', label: 'Snacks',            vol: 'EXT_SNACKS' },
  'EXTRUSADO (Tostaditas)': { tab: 'INF', label: 'Tostaditas',        vol: 'EXT_TSTAD'  },
  'TOSTADAS RECTANGULARES': { tab: 'INF', label: 'Tostadas',          vol: 'TOSTADAS'   },
  'ADMINISTRACION':         { tab: 'ADM', label: 'Administración',    vol: 'MOLINO_CASC' },
};

// ─── Costos estándar ─────────────────────────────────────────────────────────
const COSTO_STD = {
  '__MOLINO_DEP__':         29239,   // Molienda + Depósito combinado
  'ENVASADORA':             37153,
  'PLANTA PARBOIL':         38468,
  'MOLINO HARINA':          80868,
  'GALLETAS SLIM':          1177069,
  'EXTRUSADO 2 (Snacks)':   868875,
  'EXTRUSADO (Tostaditas)': 2883307,
  'ADMINISTRACION':         24000,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MES_ES = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function mesLabel(yyyymm) {
  const [y, m] = yyyymm.split('-');
  return `${MES_ES[parseInt(m, 10)]}-${y.slice(2)}`;
}
function monthsFrom(startYM) {
  const out = [];
  const [sy, sm] = startYM.split('-').map(Number);
  const now = new Date();
  let y = sy, m = sm;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
function inList(arr) { return arr.map(m => `'${m}'`).join(','); }

// ─── Auth ─────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const AUTH_TOKEN = crypto.createHash('sha256').update(DASHBOARD_PASS + 'dh-salt').digest('hex');
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('='));
  });
  return out;
}
function isAuth(req) { return parseCookies(req).dh_auth === AUTH_TOKEN; }

const LOGIN_HTML = (err) => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dos Hermanos — Acceso</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#eaecf0;display:flex;align-items:center;justify-content:center;min-height:100vh}.box{background:white;border-radius:8px;padding:40px;width:340px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h1{font-size:20px;font-weight:600;margin-bottom:24px;color:#0d0d0d}label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#666;font-weight:500}input{width:100%;padding:10px 12px;border:1.5px solid #e0e0e0;border-radius:6px;font-size:14px;margin:6px 0 16px;font-family:inherit}button{width:100%;padding:12px;background:#d8252b;color:white;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}.err{color:#d8252b;font-size:13px;margin-top:8px}</style>
</head><body><div class="box">
<h1>Tablero Dos Hermanos</h1>
<form method="POST" action="/login">
<label>Contraseña</label>
<input type="password" name="password" autofocus autocomplete="current-password">
<button type="submit">Ingresar</button>
${err ? '<p class="err">Contraseña incorrecta</p>' : ''}
</form></div></body></html>`;

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.urlencoded({ extended: false }));
app.get('/login', (req, res) => {
  if (isAuth(req)) return res.redirect('/costo-tn');
  res.send(LOGIN_HTML(false));
});
app.post('/login', (req, res) => {
  if (req.body.password === DASHBOARD_PASS) {
    res.setHeader('Set-Cookie', `dh_auth=${AUTH_TOKEN}; Path=/; HttpOnly; SameSite=Strict`);
    return res.redirect('/costo-tn');
  }
  res.status(401).send(LOGIN_HTML(true));
});
app.get('/costo-tn', (req, res) => {
  if (!isAuth(req)) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'tablero_dh_v2.html'));
});
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (!isAuth(req)) return res.redirect('/login');
  next();
});
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'tablero_fabriles_2026.html')));

// ─── GET /api/schema ──────────────────────────────────────────────────────────
app.get('/api/schema', async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request().query('SELECT TOP 3 * FROM DHControlPresup');
    res.json({ columns: Object.keys(r.recordset[0] || {}), sample: r.recordset });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/schema-op', async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request().query(`
      SELECT Cuenta,
        SUM(CASE WHEN Anomes='2026-03' THEN Importemonprincipalreal ELSE 0 END) AS mar,
        SUM(CASE WHEN Anomes='2026-04' THEN Importemonprincipalreal ELSE 0 END) AS abr
      FROM DHControlPresup
      WHERE Anomes IN ('2026-03','2026-04')
        AND RTRIM(Dimensionvalor) = 'MOLINO'
      GROUP BY Cuenta
      ORDER BY abr
    `);
    res.json({ sample: r.recordset, total: r.recordset.reduce((s,x) => s + x.gasto, 0) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/fabriles ────────────────────────────────────────────────────────
app.get('/api/fabriles', async (req, res) => {
  try {
    const p = await getPool();

    // Determinar el primer mes con datos reales en DHControlPresup
    const firstMonthRow = (await p.request().query(
      `SELECT MIN(Anomes) AS firstMes FROM DHControlPresup WHERE Anomes IS NOT NULL AND LEN(RTRIM(Anomes))=7`
    )).recordset[0];
    const firstMes  = (firstMonthRow?.firstMes || '2025-01').trim();
    const mesesKeys = monthsFrom(firstMes);
    const anio      = new Date().getFullYear().toString();
    const acumKeys  = mesesKeys.filter(m => m.startsWith(anio));
    const meses     = mesesKeys.map(mesLabel);
    const ML        = inList(mesesKeys);

    // ── 1. Gasto real (DHControlPresup) ──────────────────────────────────────
    const gastoRows = (await p.request().query(`
      SELECT
        RTRIM(Dimensionvalor)        AS dim,
        Anomes                       AS mes,
        SUM(Importemonprincipalreal) AS gastoReal
      FROM DHControlPresup
      WHERE Anomes IN (${ML})
      GROUP BY RTRIM(Dimensionvalor), Anomes
    `)).recordset;

    // ── 2. Volúmenes (DHGranosGE) ─────────────────────────────────────────────
    // Mesfecha usa formato "2025/11" (sin cero en mes de un dígito)
    const ML_GE = inList(mesesKeys.map(m => {
      const [y, mo] = m.split('-');
      return `${y}/${parseInt(mo)}`;
    }));

    // ── 2a. MOLINO: consumo cáscara desde DHGranosGE ─────────────────────────
    // Filtra producto cáscara, excluye PARBOIL (que tiene su propia cáscara)
    const molinoRows = (await p.request().query(`
      SELECT Mesfecha, SUM(Cantidadconsumo)/1000.0 AS tn
      FROM DHGranosGE
      WHERE Mesfecha IN (${ML_GE})
        AND Transaccionsubtiponombre NOT LIKE '%PARBOIL%'
        AND Producto LIKE '%CASCARA%'
      GROUP BY Mesfecha
    `)).recordset;

    // ── 2b. Resto de volúmenes desde DHGranosGE ───────────────────────────────
    const geRows = (await p.request().query(`
      SELECT Mesfecha,
        CASE
          WHEN Transaccionsubtiponombre LIKE '%ENVASADO%'                                 THEN 'ENVASADO'
          WHEN Transaccionsubtiponombre LIKE '%PARBOIL%'                                  THEN 'PARBOIL'
          WHEN Transaccionsubtiponombre LIKE '%HARINA%'                                   THEN 'HARINA'
          WHEN Transaccionsubtiponombre LIKE '%SLIM%'                                     THEN 'SLIM'
          WHEN Transaccionsubtiponombre LIKE '%TOSTADAS%'                                 THEN 'TOSTADAS'
          WHEN Transaccionsubtiponombre LIKE '%EXTRUSADO%' AND Subfamilia LIKE '%Tostadita%' THEN 'EXT_TSTAD'
          WHEN Transaccionsubtiponombre LIKE '%EXTRUSADO%'                                THEN 'EXT_SNACKS'
        END AS tipo,
        SUM(Cantidadelab)/1000.0 AS tn
      FROM DHGranosGE
      WHERE Mesfecha IN (${ML_GE})
        AND Transaccionsubtiponombre NOT LIKE '%MOLINO%'
        AND Transaccionsubtiponombre NOT LIKE '%PICKING%'
        AND Transaccionsubtiponombre NOT LIKE '%LULEMU%'
      GROUP BY Mesfecha,
        CASE
          WHEN Transaccionsubtiponombre LIKE '%ENVASADO%'                                 THEN 'ENVASADO'
          WHEN Transaccionsubtiponombre LIKE '%PARBOIL%'                                  THEN 'PARBOIL'
          WHEN Transaccionsubtiponombre LIKE '%HARINA%'                                   THEN 'HARINA'
          WHEN Transaccionsubtiponombre LIKE '%SLIM%'                                     THEN 'SLIM'
          WHEN Transaccionsubtiponombre LIKE '%TOSTADAS%'                                 THEN 'TOSTADAS'
          WHEN Transaccionsubtiponombre LIKE '%EXTRUSADO%' AND Subfamilia LIKE '%Tostadita%' THEN 'EXT_TSTAD'
          WHEN Transaccionsubtiponombre LIKE '%EXTRUSADO%'                                THEN 'EXT_SNACKS'
        END
    `)).recordset;

    // ── 3. Rubros por sector (DHControlPresup con Cuenta) ─────────────────────
    const rubrosRows = (await p.request().query(`
      SELECT RTRIM(Dimensionvalor) AS dim, RTRIM(Cuenta) AS cuenta,
             Anomes AS mes, SUM(Importemonprincipalreal) AS gasto
      FROM DHControlPresup
      WHERE Anomes IN (${ML})
      GROUP BY RTRIM(Dimensionvalor), RTRIM(Cuenta), Anomes
    `)).recordset;

    const rubrosIdx = {};
    for (const r of rubrosRows) {
      if (!rubrosIdx[r.dim]) rubrosIdx[r.dim] = {};
      if (!rubrosIdx[r.dim][r.cuenta]) rubrosIdx[r.dim][r.cuenta] = {};
      rubrosIdx[r.dim][r.cuenta][r.mes] = +r.gasto;
    }

    // ── Índices en memoria ────────────────────────────────────────────────────
    const volIdx = { 'MOLINO_CASC': {} };
    for (const r of molinoRows) {
      const [y, mo] = r.Mesfecha.split('/');
      const mes = `${y}-${mo.padStart(2, '0')}`;
      volIdx['MOLINO_CASC'][mes] = +r.tn;
    }
    for (const r of geRows) {
      if (!r.tipo) continue;
      const [y, mo] = r.Mesfecha.split('/');
      const mes = `${y}-${mo.padStart(2, '0')}`;
      if (!volIdx[r.tipo]) volIdx[r.tipo] = {};
      volIdx[r.tipo][mes] = (volIdx[r.tipo][mes] || 0) + +r.tn;
    }
    function getVol(volKey, mes) {
      return (volKey && volIdx[volKey]?.[mes]) ?? null;
    }

    const gastoIdx = {};
    for (const r of gastoRows) {
      if (!gastoIdx[r.dim]) gastoIdx[r.dim] = {};
      gastoIdx[r.dim][r.mes] = +r.gastoReal;
    }

    // ── Construir grupos de un tab ────────────────────────────────────────────
    function buildTab(tabKey) {
      const rubros = Object.entries(RUBRO_CFG).filter(([, c]) => c.tab === tabKey);
      const groups = rubros.map(([dim, cfg]) => {
        const md   = gastoIdx[dim] || {};
        const vArr = mesesKeys.map(m => getVol(cfg.vol, m));
        const gArr = mesesKeys.map(m => md[m] ?? null);
        const pArr = mesesKeys.map(m => {
          const v = getVol(cfg.vol, m), g = md[m];
          return (v && g != null) ? Math.round(g / v) : null;
        });
        const vAcum = acumKeys.reduce((s, m) => s + (getVol(cfg.vol, m) || 0), 0);
        const gAcum = acumKeys.reduce((s, m) => s + (md[m] || 0), 0);
        return {
          g: cfg.label,
          rows: [
            { l: 'Volumen (tn)', v: vArr, a: vAcum > 0 ? +vAcum.toFixed(1) : null, fmt: 'vol' },
            { l: 'Gasto ($)',    v: gArr, a: gAcum || null,                          fmt: 'gas' },
            { l: '$/tn',        v: pArr, a: vAcum > 0 ? Math.round(gAcum / vAcum) : null, fmt: 'ptn' },
          ]
        };
      });

      // Totales
      const totV = mesesKeys.map(m =>
        rubros.reduce((s, [, c]) => s + (getVol(c.vol, m) || 0), 0) || null
      );
      const totG = mesesKeys.map(m =>
        rubros.reduce((s, [dim]) => s + (gastoIdx[dim]?.[m] || 0), 0) || null
      );
      const totP = mesesKeys.map((m, i) => {
        const s = groups.reduce((acc, grp) => acc + (grp.rows.find(r => r.fmt==='ptn')?.v[i] ?? 0), 0);
        return s || null;
      });
      const totVAcum = acumKeys.reduce((s, m) => s + (rubros.reduce((r, [, c]) => r + (getVol(c.vol, m) || 0), 0)), 0);
      const totGAcum = acumKeys.reduce((s, m) => s + (rubros.reduce((r, [dim]) => r + (gastoIdx[dim]?.[m] || 0), 0)), 0);
      const totPAcum = groups.reduce((s, grp) => s + (grp.rows.find(r => r.fmt==='ptn')?.a ?? 0), 0);
      const label = { VA: 'Villa Adela', INF: 'Inflados', ADM: 'Administración' }[tabKey];
      if (tabKey !== 'ADM') {
        groups.push({
          g: `Total ${label}`, tot: true,
          rows: [
            { l: 'Volumen (tn)', v: totV, a: totVAcum > 0 ? +totVAcum.toFixed(1) : null, fmt: 'vol' },
            { l: 'Gasto ($)',    v: totG, a: totGAcum || null,                              fmt: 'gas' },
            { l: '$/tn',        v: totP, a: totPAcum || null,                               fmt: 'ptn' },
          ]
        });
      }
      return groups;
    }

    // ── COS: $/tn por sector (solo meses cerrados) ───────────────────────────
    const nowD = new Date();
    const currentMonthKey = `${nowD.getFullYear()}-${String(nowD.getMonth()+1).padStart(2,'0')}`;
    const closedKeys     = mesesKeys.filter(m => m < currentMonthKey);
    const trimClosedKeys = closedKeys.slice(-3);
    const acumClosedKeys = closedKeys.filter(m => m.startsWith(anio));
    const ultimoClosedKey = closedKeys[closedKeys.length - 1] || mesesKeys[mesesKeys.length - 1];

    // Etiquetas de período para los encabezados
    const cosUltLabel   = mesLabel(ultimoClosedKey);
    const cosTrimLabel  = trimClosedKeys.length > 1
      ? `${mesLabel(trimClosedKeys[0])} a ${mesLabel(trimClosedKeys[trimClosedKeys.length-1])}`
      : mesLabel(trimClosedKeys[0] || ultimoClosedKey);
    const cosAnualLabel = acumClosedKeys.length > 1
      ? `${mesLabel(acumClosedKeys[0])} a ${mesLabel(acumClosedKeys[acumClosedKeys.length-1])}`
      : mesLabel(acumClosedKeys[0] || ultimoClosedKey);

    const cosMap = {};
    for (const [dim, cfg] of Object.entries(RUBRO_CFG)) {
      if (!cfg.vol) continue;
      const md = gastoIdx[dim] || {};
      const ptn = keys => {
        let v = 0, g = 0;
        keys.forEach(m => { v += getVol(cfg.vol, m) || 0; g += md[m] || 0; });
        return v > 0 ? Math.round(g / v) : null;
      };
      const ultKey = [...closedKeys].reverse().find(m => {
        const v = getVol(cfg.vol, m), g = md[m];
        return v && g != null && v > 0;
      }) || ultimoClosedKey;
      const ult = ptn([ultKey]), trim = ptn(trimClosedKeys), anual = ptn(acumClosedKeys);
      cosMap[dim] = {
        n:     cfg.label,
        ult:   ult   != null ? Math.abs(ult)   : null,
        trim:  trim  != null ? Math.abs(trim)  : null,
        anual: anual != null ? Math.abs(anual) : null,
        std:   COSTO_STD[dim] ?? null,
      };
    }
    // Fila combinada Molienda+Depósito (mismo vol MOLINO_CASC, gastos sumados)
    {
      const dims = ['MOLINO', 'DEPOSITOS DE ARROZ'];
      const ptnComb = keys => {
        let v = 0, g = 0;
        keys.forEach(m => {
          v += getVol('MOLINO_CASC', m) || 0;
          g += dims.reduce((s, d) => s + (gastoIdx[d]?.[m] || 0), 0);
        });
        return v > 0 ? Math.round(g / v) : null;
      };
      const ultKeyComb = [...closedKeys].reverse().find(m => getVol('MOLINO_CASC', m) && dims.some(d => gastoIdx[d]?.[m])) || ultimoClosedKey;
      const ult = ptnComb([ultKeyComb]), trim = ptnComb(trimClosedKeys), anual = ptnComb(acumClosedKeys);
      cosMap['__MOLINO_DEP__'] = {
        n:       'Molienda+Depósito',
        combined: true,
        ult:   ult   != null ? Math.abs(ult)   : null,
        trim:  trim  != null ? Math.abs(trim)  : null,
        anual: anual != null ? Math.abs(anual) : null,
        std:   COSTO_STD['__MOLINO_DEP__'],
      };
    }
    const COS_ORDER = [
      'MOLINO', 'DEPOSITOS DE ARROZ', '__MOLINO_DEP__',
      'ENVASADORA', 'PLANTA PARBOIL', 'MOLINO HARINA',
      'GALLETAS SLIM', 'EXTRUSADO 2 (Snacks)', 'EXTRUSADO (Tostaditas)', 'TOSTADAS RECTANGULARES',
      'ADMINISTRACION',
    ];
    const COS = COS_ORDER.map(k => cosMap[k]).filter(Boolean);

    // ── DETAIL: rubros por sector ─────────────────────────────────────────────
    const DETAIL = {};
    for (const dim of Object.keys(RUBRO_CFG)) {
      const cuentas = rubrosIdx[dim] || {};
      DETAIL[dim] = {};
      Object.keys(cuentas).forEach(cuenta => {
        DETAIL[dim][cuenta] = mesesKeys.map(m => {
          const v = cuentas[cuenta]?.[m];
          return v != null ? Math.abs(v) : 0;
        });
      });
    }

    // Gasto total acumulado
    const gastoTotal = Object.values(gastoIdx)
      .flatMap(md => acumKeys.map(m => md[m] || 0))
      .reduce((s, v) => s + v, 0);

    res.json({
      meses,
      VA:  buildTab('VA'),
      INF: buildTab('INF'),
      ADM: buildTab('ADM'),
      COS,
      cosUltLabel,
      cosTrimLabel,
      cosAnualLabel,
      gastoTotal,
      DETAIL,
      lastClosedMonth: ultimoClosedKey,
      actualizadoA: (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }); })(),
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Tablero Fabriles → http://localhost:${PORT}`);
  console.log(`Schema          → http://localhost:${PORT}/api/schema`);
});
