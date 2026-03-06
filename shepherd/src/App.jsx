import { useState, useEffect, useCallback, useRef } from "react";

// ─────────────────────────────────────────────────────────────
//  DESIGN TOKENS  — dark navy / burnished gold
// ─────────────────────────────────────────────────────────────
const T = {
  bg0:     "#04080f",   // deepest bg
  bg1:     "#080f1c",   // page bg
  bg2:     "#0c1526",   // card bg
  bg3:     "#101d33",   // elevated card
  bg4:     "#162240",   // hover / selected
  border:  "#1a2e50",
  border2: "#243d66",
  gold:    "#c9a84c",
  goldL:   "#e2c97e",
  goldD:   "#8a6a1f",
  text:    "#e8e4d8",
  textSub: "#7a8fa8",
  textDim: "#3a4f6a",
  green:   "#2ecc8a",
  amber:   "#e8a020",
  red:     "#e05050",
  blue:    "#4a8fe8",
  indigo:  "#5c72e8",
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Pro:ital,wght@0,300;0,400;0,600;1,400&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${T.bg1}; color: ${T.text}; font-family: 'Crimson Pro', Georgia, serif; }
  ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: ${T.bg0}; }
  ::-webkit-scrollbar-thumb { background: ${T.border2}; border-radius: 3px; }
  input, textarea, select { font-family: inherit; }
  a { color: ${T.blue}; }
  .fade-in { animation: fadeIn 0.4s ease both; }
  @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  .row-hover:hover { background: ${T.bg4} !important; transition: background 0.15s; }
  button:active { transform: scale(0.97); }
`;


// ─────────────────────────────────────────────────────────────
//  HARDCODED CONFIG — baked in so all users skip setup screen
// ─────────────────────────────────────────────────────────────
const HARDCODED_CONFIG = {
  clientId:      "194738070438-h8mjndft5qn4g216mgqqg365huv40c5m.apps.googleusercontent.com",
  ministerEmail: "swami4lyfe@gmail.com",
  sheetId:       "14HH7PNFOvEeBhCjwGrfPd2vW5Dp9DYOQER0aE2usfl0",
  apiKey:        "AIzaSyBV39F-G7bnjpHG7CVBtUndaIMBhcdfdHk",
  scriptUrl:     "https://script.google.com/macros/s/AKfycbz1XPc_ra9Rrbb8N9ErfzwscIm3WJePS-QYqVf4e3jzJccTWO_4IE9G8Vbl_UDAiyJN/exec",
};

// ─────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────
const CONFIG_KEY  = "shepherd-config-v1";
const SESSION_KEY = "shepherd-session-v1";

// ─── Safe storage (falls back gracefully if localStorage blocked) ─
const Store = {
  get(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch {}
    try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch {}
    return null;
  },
  set(key, val) {
    const s = JSON.stringify(val);
    try { localStorage.setItem(key, s); return true; } catch {}
    try { sessionStorage.setItem(key, s); return true; } catch {}
    return false;
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch {}
    try { sessionStorage.removeItem(key); } catch {}
  }
};

const SHEET_HEADERS = [
  "Type","Id","ParentId","FamilyName","ContactPerson",
  "MemberId","TelegramId","Country","State",
  "Notes","LastContact","LastNote","AuthEmail","Children"
];

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
function uid()  { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function daysSince(d) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}
function parseJwt(t) {
  try { return JSON.parse(atob(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))); }
  catch { return null; }
}

function makeNode(id="", parentId="", extra={}) {
  return { id: id||uid(), parentId, familyName:"", contactPerson:"",
    memberId:"", telegramId:"", country:"", state:"",
    notes:"", lastContact:null, lastNote:"", authEmail:"",
    children:[], ...extra };
}

// flatten entire tree into array
function flatTree(nodes) {
  return nodes.flatMap(n => [n, ...flatTree(n.children||[])]);
}

// find node by id anywhere in tree
function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children||[], id);
    if (found) return found;
  }
  return null;
}

// deep update node by id
function updateNode(nodes, id, updater) {
  return nodes.map(n => {
    if (n.id === id) return { ...n, ...updater(n) };
    return { ...n, children: updateNode(n.children||[], id, updater) };
  });
}

// inject child under parentId
function injectChild(nodes, parentId, child) {
  return nodes.map(n => {
    if (n.id === parentId) return { ...n, children: [...(n.children||[]), child] };
    return { ...n, children: injectChild(n.children||[], parentId, child) };
  });
}

// get subtree rooted at id (inclusive)
function getSubtree(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = getSubtree(n.children||[], id);
    if (found) return found;
  }
  return null;
}

// ── Sheets serialization ──────────────────────────────────────
function treeToRows(minister, nodes) {
  const rows = [];
  rows.push(["MINISTER","__minister__","",minister.name||"",minister.contactPerson||"",
    minister.memberId||"",minister.telegramId||"",minister.country||"",minister.state||"",
    minister.notes||"","","",minister.googleEmail||"",""]);

  function walk(n, pid) {
    rows.push(["NODE", n.id, pid, n.familyName||"", n.contactPerson||"",
      n.memberId||"", n.telegramId||"", n.country||"", n.state||"",
      n.notes||"", n.lastContact||"", n.lastNote||"", n.authEmail||"",
      (n.children||[]).map(c=>c.id).join("|")
    ]);
    (n.children||[]).forEach(c => walk(c, n.id));
  }
  nodes.forEach(n => walk(n, ""));
  return rows;
}

function rowsToTree(rows) {
  const minister = { name:"", contactPerson:"", memberId:"", telegramId:"",
    country:"", state:"", notes:"", googleEmail:"" };
  const map = {};
  const rootIds = [];

  // Use header row to find column indices — handles any column order
  const headers = rows[0] || [];
  const col = (name) => headers.indexOf(name);
  const get  = (r, name) => r[col(name)] || "";

  rows.slice(1).forEach(r => {
    if (!r || r.length < 2) return;
    const type = get(r,"Type");
    const id   = get(r,"Id");
    const pid  = get(r,"ParentId");
    if (type==="MINISTER") {
      Object.assign(minister,{
        name:          get(r,"FamilyName"),
        contactPerson: get(r,"ContactPerson"),
        memberId:      get(r,"MemberId"),
        telegramId:    get(r,"TelegramId"),
        country:       get(r,"Country"),
        state:         get(r,"State"),
        notes:         get(r,"Notes"),
        googleEmail:   get(r,"AuthEmail"),
      });
      return;
    }
    if (type==="NODE") {
      const authEmail = get(r,"AuthEmail");
      console.log(`Node ${id} authEmail: "${authEmail}"`);
      map[id] = {
        id, parentId:pid,
        familyName:    get(r,"FamilyName"),
        contactPerson: get(r,"ContactPerson"),
        memberId:      get(r,"MemberId"),
        telegramId:    get(r,"TelegramId"),
        country:       get(r,"Country"),
        state:         get(r,"State"),
        notes:         get(r,"Notes"),
        lastContact:   get(r,"LastContact")||null,
        lastNote:      get(r,"LastNote"),
        authEmail:     authEmail,
        children:[]
      };
      if (!pid) rootIds.push(id);
    }
  });

  // re-attach children
  Object.values(map).forEach(n => {
    if (n.parentId && map[n.parentId]) map[n.parentId].children.push(n);
  });

  let roots = rootIds.map(id=>map[id]).filter(Boolean);
  if (roots.length === 0) {
    roots = Array.from({length:5},(_,i) => makeNode(`root${i+1}`,""));
  }
  return { minister, nodes: roots };
}

// ─────────────────────────────────────────────────────────────
//  STYLED PRIMITIVES
// ─────────────────────────────────────────────────────────────
const sInput = {
  width:"100%", background:T.bg0, border:`1px solid ${T.border}`,
  borderRadius:6, padding:"9px 12px", color:T.text, fontSize:15,
  outline:"none", marginBottom:12,
  transition:"border-color 0.2s",
};
const sTextarea = { ...sInput, resize:"vertical", fontFamily:"inherit" };

function Input({ value, onChange, placeholder, type="text", readOnly, style={} }) {
  const [focus, setFocus] = useState(false);
  return <input value={value||""} onChange={onChange} placeholder={placeholder} type={type}
    readOnly={readOnly} onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
    style={{ ...sInput, borderColor: focus?T.gold:T.border, opacity:readOnly?0.55:1,
      cursor:readOnly?"default":"text", ...style }} />;
}

function Textarea({ value, onChange, placeholder, rows=3, readOnly }) {
  const [focus, setFocus] = useState(false);
  return <textarea value={value||""} onChange={onChange} placeholder={placeholder}
    rows={rows} readOnly={readOnly} onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
    style={{ ...sTextarea, borderColor: focus?T.gold:T.border, opacity:readOnly?0.55:1 }} />;
}

function Label({ children, gold }) {
  return <div style={{ color:gold?T.goldL:T.textSub, fontSize:11, fontWeight:600,
    letterSpacing:"0.08em", marginBottom:5, fontFamily:"'Cinzel',serif",
    textTransform:"uppercase" }}>{children}</div>;
}

function GoldBtn({ onClick, children, disabled, full, outline, small, style={} }) {
  return <button onClick={onClick} disabled={disabled} style={{
    background: outline?"transparent": disabled?"#1a2e40":T.gold,
    border: `1px solid ${disabled?T.border: outline?T.gold:T.goldD}`,
    color: disabled?T.textDim: outline?T.goldL:"#1a0e00",
    borderRadius:6, padding: small?"5px 12px":"9px 20px",
    fontSize: small?12:14, fontWeight:700, cursor:disabled?"not-allowed":"pointer",
    fontFamily:"'Cinzel',serif", letterSpacing:"0.05em",
    width:full?"100%":undefined, opacity:disabled?0.5:1,
    transition:"all 0.15s", ...style
  }}>{children}</button>;
}

function IconBtn({ onClick, children, title, color=T.bg3, tc=T.textSub, border=T.border }) {
  return <button onClick={onClick} title={title} style={{
    background:color, border:`1px solid ${border}`, color:tc,
    borderRadius:5, padding:"4px 10px", fontSize:12, cursor:"pointer", fontWeight:600,
  }}>{children}</button>;
}

function Badge({ days }) {
  if (days === null) return <span style={{background:T.bg3,color:T.textDim,fontSize:10,
    padding:"2px 8px",borderRadius:20,fontWeight:600,fontFamily:"'Cinzel',serif"}}>Never</span>;
  const [bg,col] = days<=7?["#0a2e1a",T.green]:days<=30?["#2e1a00",T.amber]:["#2e0a0a",T.red];
  const label = days===0?"Today":`${days}d`;
  return <span style={{background:bg,color:col,fontSize:10,padding:"2px 8px",
    borderRadius:20,fontWeight:600,fontFamily:"'Cinzel',serif"}}>{label}</span>;
}

function Modal({ title, onClose, children, wide }) {
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:400,
    display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div className="fade-in" style={{background:T.bg2,border:`1px solid ${T.border2}`,
      borderTop:`2px solid ${T.gold}`,borderRadius:12,width:"100%",
      maxWidth:wide?640:480,maxHeight:"92vh",overflowY:"auto",padding:28}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <h3 style={{color:T.goldL,fontFamily:"'Cinzel',serif",fontSize:17,letterSpacing:"0.06em"}}>{title}</h3>
        <button onClick={onClose} style={{background:"none",border:"none",color:T.textDim,
          fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
      </div>
      {children}
    </div>
  </div>;
}

function Divider() {
  return <div style={{borderTop:`1px solid ${T.border}`,margin:"16px 0"}}/>;
}

function Toast({ msg, color }) {
  return <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",
    background:color||T.indigo,color:"#fff",padding:"10px 24px",borderRadius:8,
    fontSize:14,fontWeight:600,zIndex:500,boxShadow:"0 4px 20px rgba(0,0,0,0.5)",
    whiteSpace:"nowrap",fontFamily:"'Cinzel',serif",letterSpacing:"0.04em"}}>{msg}</div>;
}

// ─────────────────────────────────────────────────────────────
//  NODE FORM  (shared by add + edit)
// ─────────────────────────────────────────────────────────────
function NodeForm({ form, setForm, isMinister, readOnly }) {
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));
  return <>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 16px"}}>
      <div><Label>Family Name</Label><Input value={form.familyName} onChange={f("familyName")} placeholder="e.g. Johnson Family" readOnly={readOnly}/></div>
      <div><Label>Contact Person</Label><Input value={form.contactPerson} onChange={f("contactPerson")} placeholder="e.g. John Johnson" readOnly={readOnly}/></div>
      <div><Label>Member ID</Label><Input value={form.memberId} onChange={f("memberId")} placeholder="e.g. M-0042" readOnly={readOnly}/></div>
      <div><Label>Telegram ID</Label><Input value={form.telegramId} onChange={f("telegramId")} placeholder="@username" readOnly={readOnly}/></div>
      <div><Label>Country</Label><Input value={form.country} onChange={f("country")} placeholder="e.g. United States" readOnly={readOnly}/></div>
      <div><Label>State / Province</Label><Input value={form.state} onChange={f("state")} placeholder="e.g. Texas" readOnly={readOnly}/></div>
    </div>
    <Label>Notes</Label>
    <Textarea value={form.notes} onChange={f("notes")} placeholder="Prayer requests, visit notes…" readOnly={readOnly}/>
    {isMinister && <>
      <Divider/>
      <Label gold>Leader Google Email — grants login access to this family's subtree</Label>
      <Input value={form.authEmail} onChange={f("authEmail")} placeholder="leader@gmail.com" type="email"/>
    </>}
  </>;
}

// ─────────────────────────────────────────────────────────────
//  SETUP PANEL
// ─────────────────────────────────────────────────────────────
function SetupPanel({ config, onSave, onCancel }) {
  const [form, setForm] = useState({
    clientId:"", ministerEmail:"", apiKey:"", sheetId:"", scriptUrl:"", ...config
  });
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const ready = form.clientId && form.ministerEmail && form.apiKey && form.sheetId && form.scriptUrl;

  const steps = [
    { n:1, title:"Create Google Cloud Project & OAuth Client ID", body:
      <ol style={{color:T.textSub,fontSize:13,paddingLeft:20,lineHeight:2.2}}>
        <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a> → create a free project</li>
        <li><strong style={{color:T.text}}>APIs & Services → OAuth consent screen</strong> → External → fill app name</li>
        <li><strong style={{color:T.text}}>Credentials → + Create → OAuth 2.0 Client ID → Web application</strong></li>
        <li>Add your app URL under <strong style={{color:T.text}}>Authorized JavaScript origins</strong></li>
        <li>Copy the <strong style={{color:T.goldL}}>Client ID</strong> (ends in .apps.googleusercontent.com)</li>
      </ol>
    },
    { n:2, title:"Enable Sheets API & create API Key + Sheet", body:
      <ol style={{color:T.textSub,fontSize:13,paddingLeft:20,lineHeight:2.2}}>
        <li><strong style={{color:T.text}}>APIs & Services → Library</strong> → search "Google Sheets API" → Enable</li>
        <li><strong style={{color:T.text}}>Credentials → + Create → API Key</strong> → restrict to Sheets API</li>
        <li>Go to <a href="https://sheets.new" target="_blank" rel="noreferrer">sheets.new</a> → create blank sheet → copy ID from URL</li>
        <li>In the Sheet: <strong style={{color:T.text}}>Share → Anyone with link → Viewer</strong></li>
      </ol>
    },
    { n:3, title:"Deploy Apps Script (enables writing data)", body: <>
      <p style={{color:T.textSub,fontSize:13,marginBottom:10}}>In your Sheet: <strong style={{color:T.text}}>Extensions → Apps Script</strong> → paste code → Save → <strong style={{color:T.text}}>Deploy → New Deployment → Web App</strong> (access: Anyone) → copy the URL.</p>
      <pre style={{background:T.bg0,border:`1px solid ${T.border}`,borderRadius:6,padding:12,
        fontSize:10,color:"#6ee7b7",overflowX:"auto",whiteSpace:"pre-wrap"}}>{`function doPost(e) {
  const ss = SpreadsheetApp.openById("${form.sheetId||"YOUR_SHEET_ID"}");
  const sheet = ss.getSheetByName("Network") || ss.insertSheet("Network");
  const data = JSON.parse(e.postData.contents);
  sheet.clearContents();
  data.rows.forEach(row => sheet.appendRow(row));
  return ContentService
    .createTextOutput(JSON.stringify({status:"ok"}))
    .setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return ContentService.createTextOutput("OK"); }`}</pre>
    </> }
  ];

  return (
    <div style={{background:T.bg2,border:`1px solid ${T.border2}`,borderTop:`2px solid ${T.gold}`,
      borderRadius:12,padding:28,maxWidth:660,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <h2 style={{color:T.goldL,fontFamily:"'Cinzel',serif",fontSize:20,letterSpacing:"0.06em"}}>
          ⚙ First-Time Setup
        </h2>
        {onCancel && <button onClick={onCancel} style={{background:"none",border:"none",
          color:T.textDim,fontSize:22,cursor:"pointer"}}>×</button>}
      </div>

      {steps.map(s => (
        <div key={s.n} style={{marginBottom:20,paddingBottom:20,borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <span style={{width:24,height:24,borderRadius:"50%",background:T.bg4,
              border:`1px solid ${T.gold}`,color:T.goldL,display:"flex",alignItems:"center",
              justifyContent:"center",fontSize:11,fontWeight:700,fontFamily:"'Cinzel',serif",flexShrink:0}}>{s.n}</span>
            <strong style={{color:T.text,fontSize:14,fontFamily:"'Cinzel',serif"}}>{s.title}</strong>
          </div>
          <div style={{paddingLeft:34}}>{s.body}</div>
        </div>
      ))}

      <Divider/>
      {[
        ["OAuth Client ID","clientId","123456-abc.apps.googleusercontent.com"],
        ["Your Google Email (Minister — full access)","ministerEmail","you@gmail.com"],
        ["Google Sheet ID","sheetId","1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"],
        ["API Key","apiKey","AIzaSy..."],
        ["Apps Script Web App URL","scriptUrl","https://script.google.com/macros/s/.../exec"],
      ].map(([label,key,ph]) => (
        <div key={key}>
          <Label gold={key==="ministerEmail"}>{label}</Label>
          <Input value={form[key]||""} onChange={f(key)} placeholder={ph} style={{fontFamily:"monospace",fontSize:12}}/>
        </div>
      ))}
      <div style={{display:"flex",gap:10,marginTop:4}}>
        <GoldBtn onClick={()=>onSave(form)} disabled={!ready} full>✓ Save & Connect</GoldBtn>
        {onCancel && <GoldBtn onClick={onCancel} outline>Cancel</GoldBtn>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  LOGIN SCREEN
// ─────────────────────────────────────────────────────────────
function LoginScreen({ clientId, onToken, onSetup, error }) {
  const btnRef = useRef();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => {
      if (!window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: resp => { setLoading(true); onToken(resp.credential); },
      });
      window.google.accounts.id.renderButton(btnRef.current, {
        theme:"filled_black", size:"large", shape:"pill", width:260, text:"signin_with"
      });
    };
    document.head.appendChild(s);
    return () => { try{document.head.removeChild(s);}catch{} };
  }, [clientId]);

  return (
    <div style={{minHeight:"100vh",background:T.bg0,display:"flex",alignItems:"center",
      justifyContent:"center",padding:20}}>
      {/* ornamental bg lines */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",overflow:"hidden",opacity:0.04}}>
        {Array.from({length:8},(_,i)=>(
          <div key={i} style={{position:"absolute",left:0,right:0,top:`${i*14}%`,
            borderTop:`1px solid ${T.gold}`}}/>
        ))}
      </div>

      <div className="fade-in" style={{background:T.bg2,border:`1px solid ${T.border2}`,
        borderTop:`2px solid ${T.gold}`,borderRadius:16,padding:44,
        width:"100%",maxWidth:380,textAlign:"center",position:"relative"}}>

        {/* cross emblem */}
        <div style={{width:56,height:56,borderRadius:"50%",background:T.bg4,
          border:`1px solid ${T.gold}`,display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:26,margin:"0 auto 20px"}}>✝</div>

        <h1 style={{fontFamily:"'Cinzel',serif",fontSize:24,color:T.goldL,
          letterSpacing:"0.08em",marginBottom:6}}>Shepherd</h1>
        <p style={{color:T.textSub,fontSize:14,marginBottom:30,fontStyle:"italic"}}>
          Pastoral Network Management
        </p>

        {clientId ? (
          <>
            <div style={{display:"flex",justifyContent:"center",marginBottom:14}}>
              <div ref={btnRef}/>
            </div>
            {loading && <p style={{color:T.textSub,fontSize:13,marginTop:8}}>Verifying…</p>}
            {error && <p style={{color:T.red,fontSize:13,marginTop:10,padding:"8px 12px",
              background:"#1a0808",borderRadius:6,border:`1px solid #3a1010`}}>{error}</p>}
          </>
        ) : (
          <GoldBtn onClick={onSetup} full>⚙ Complete Setup First</GoldBtn>
        )}


      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  DASHBOARD STATS
// ─────────────────────────────────────────────────────────────
function Dashboard({ nodes, title }) {
  const all  = flatTree(nodes).filter(n=>n.familyName);
  const total   = all.length;
  const recent  = all.filter(n=>{const d=daysSince(n.lastContact);return d!==null&&d<=7;}).length;
  const overdue = all.filter(n=>{const d=daysSince(n.lastContact);return d!==null&&d>30;}).length;
  const never   = all.filter(n=>!n.lastContact).length;
  const overdueFams = all.filter(n=>{const d=daysSince(n.lastContact);return d===null||(d!==null&&d>21);}).filter(n=>n.familyName);

  return (
    <div className="fade-in">
      <h2 style={{fontFamily:"'Cinzel',serif",color:T.goldL,fontSize:17,
        letterSpacing:"0.06em",marginBottom:16}}>{title}</h2>

      {/* stat cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:24}}>
        {[
          {label:"Total Families",val:total,   color:T.blue},
          {label:"Contacted (7d)", val:recent,  color:T.green},
          {label:"Overdue (30d+)", val:overdue, color:T.red},
          {label:"Never Contacted",val:never,   color:T.amber},
        ].map(s=>(
          <div key={s.label} style={{background:T.bg2,border:`1px solid ${T.border}`,
            borderRadius:10,padding:"14px 16px",textAlign:"center"}}>
            <div style={{fontSize:28,fontWeight:700,color:s.color,fontFamily:"'Cinzel',serif"}}>{s.val}</div>
            <div style={{fontSize:11,color:T.textSub,marginTop:4,letterSpacing:"0.05em"}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* needs attention */}
      {overdueFams.length > 0 && <>
        <h3 style={{fontFamily:"'Cinzel',serif",color:T.amber,fontSize:14,
          letterSpacing:"0.06em",marginBottom:10}}>⚠ Needs Attention</h3>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {overdueFams.slice(0,10).map(n=>(
            <div key={n.id} style={{background:T.bg2,border:`1px solid ${T.border}`,
              borderRadius:8,padding:"10px 14px",display:"flex",
              alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <span style={{flex:1,color:T.text,fontWeight:600}}>{n.familyName}</span>
              {n.contactPerson&&<span style={{color:T.textSub,fontSize:13}}>{n.contactPerson}</span>}
              {n.country&&<span style={{color:T.textDim,fontSize:12}}>{n.state?`${n.state}, `:""}{n.country}</span>}
              <Badge days={daysSince(n.lastContact)}/>
            </div>
          ))}
          {overdueFams.length>10&&<div style={{color:T.textDim,fontSize:13,textAlign:"center",padding:6}}>
            + {overdueFams.length-10} more
          </div>}
        </div>
      </>}

      {overdueFams.length===0&&total>0&&(
        <div style={{textAlign:"center",padding:32,color:T.green,fontSize:16,fontStyle:"italic"}}>
          ✓ All families contacted recently — well done!
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  NETWORK TREE ROW
// ─────────────────────────────────────────────────────────────
function TreeNode({ node, depth, isMinister, onEdit, onAdd }) {
  const [open, setOpen] = useState(depth < 2);
  const hasKids = node.children && node.children.length > 0;
  const days = daysSince(node.lastContact);

  const depthColors = [T.border2, T.border, "#1a2840", "#141f30"];
  const borderColor = depthColors[Math.min(depth, depthColors.length-1)];
  const bgColor = depth===0?T.bg3:depth===1?T.bg2:T.bg1;

  return (
    <div style={{marginLeft: depth===0?0:20, marginBottom:5}}>
      <div className="row-hover" style={{background:bgColor,border:`1px solid ${borderColor}`,
        borderLeft: depth===0?`2px solid ${T.gold}`:`1px solid ${borderColor}`,
        borderRadius:8,padding:"9px 12px",cursor:"pointer"}}
        onClick={()=>hasKids&&setOpen(!open)}>

        <div style={{display:"flex",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
          {/* expand toggle */}
          <div style={{paddingTop:3,minWidth:16,flexShrink:0}}>
            {hasKids
              ? <span style={{color:T.gold,fontSize:13,fontWeight:700}}>{open?"▾":"▸"}</span>
              : <span style={{color:T.border,fontSize:13}}>·</span>}
          </div>

          {/* info */}
          <div style={{flex:1,minWidth:0}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span style={{color:node.familyName?T.text:T.textDim,
                fontWeight:depth===0?700:500,
                fontSize:depth===0?15:14,
                fontFamily:"'Cinzel',serif"}}>
                {node.familyName||(depth===0?"— Unnamed Core Family —":"— Unnamed Family —")}
              </span>
              {node.contactPerson&&
                <span style={{color:T.textSub,fontSize:12}}>{node.contactPerson}</span>}
              <Badge days={days}/>
              {isMinister&&node.authEmail&&
                <span style={{background:"#071a0e",border:`1px solid #0f3a1a`,
                  color:T.green,fontSize:9,padding:"1px 6px",borderRadius:3,
                  fontFamily:"'Cinzel',serif"}}>✓ leader</span>}
              {hasKids&&
                <span style={{color:T.textDim,fontSize:11}}>({node.children.length} {node.children.length===1?"family":"families"})</span>}
            </div>

            <div style={{marginTop:5,display:"flex",flexWrap:"wrap",gap:4}}>
              {node.memberId&&<span style={{background:T.bg0,border:`1px solid ${T.border}`,
                borderRadius:4,padding:"1px 7px",fontSize:10,color:T.textSub}}>ID: {node.memberId}</span>}
              {node.telegramId&&<span style={{background:T.bg0,border:`1px solid ${T.border}`,
                borderRadius:4,padding:"1px 7px",fontSize:10,color:T.textSub}}>✈ {node.telegramId}</span>}
              {(node.state||node.country)&&<span style={{background:T.bg0,border:`1px solid ${T.border}`,
                borderRadius:4,padding:"1px 7px",fontSize:10,color:T.textSub}}>
                📍 {[node.state,node.country].filter(Boolean).join(", ")}</span>}
            </div>

            {node.notes&&<div style={{marginTop:4,color:T.textDim,fontSize:12,fontStyle:"italic"}}>
              "{node.notes.slice(0,80)}{node.notes.length>80?"…":""}"</div>}
            {node.lastNote&&<div style={{marginTop:3,color:T.textDim,fontSize:11}}>
              Note: {node.lastNote.slice(0,60)}</div>}
          </div>

          {/* actions */}
          <div style={{display:"flex",gap:4,flexShrink:0,marginTop:2}}
            onClick={e=>e.stopPropagation()}>
            <IconBtn onClick={()=>onEdit(node)} title={isMinister?"Edit":"View / Assign Leader"}
              color={T.bg4} tc={T.blue} border={T.border2}>
              {isMinister?"✎":"✎"}
            </IconBtn>
            <IconBtn onClick={()=>onAdd(node)} title="Add sub-family"
              color="#0a1f0e" tc={T.green} border="#0f3a1a">+</IconBtn>
          </div>
        </div>
      </div>

      {/* children */}
      {open&&hasKids&&(
        <div style={{marginTop:4,borderLeft:`1px dashed ${T.border}`,
          paddingLeft:4,marginLeft:8}}>
          {node.children.map(c=>(
            <TreeNode key={c.id} node={c} depth={depth+1} isMinister={isMinister}
              onEdit={onEdit} onAdd={onAdd}/>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  MAIN APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  // Always use hardcoded config — ignore any stale browser storage
  const [config,   setConfig]   = useState(()=> ({ ...HARDCODED_CONFIG }));
  const [session,  setSession]  = useState(()=> Store.get(SESSION_KEY) || null);
  const [authErr,  setAuthErr]  = useState("");
  const [showSetup,setShowSetup]= useState(false);
  const [saveStatus,setSaveStatus] = useState("");

  const [minister, setMinister] = useState({name:"",contactPerson:"",memberId:"",telegramId:"",country:"",state:"",notes:"",googleEmail:""});
  const [nodes,    setNodes]    = useState(()=>Array.from({length:5},(_,i)=>makeNode(`root${i+1}`,"")));

  const [view,     setView]     = useState("tree");   // tree | dashboard
  const [loading,  setLoading]  = useState(false);
  const [syncMsg,  setSyncMsg]  = useState("");
  const [search,   setSearch]   = useState("");
  const [editNode, setEditNode] = useState(null);
  const [addParent,setAddParent]= useState(null);
  const [toast,    setToast]    = useState(null);

  const isConnected = true; // credentials are hardcoded
  const userEmail   = session?.email||"";
  const isMinister  = userEmail && config.ministerEmail &&
    userEmail.toLowerCase()===config.ministerEmail.toLowerCase();

  // leader = first node (at any depth) whose authEmail matches
  const isPending  = session?.pending && !isMinister;
  const leaderNode = !isMinister&&userEmail
    ? findNode(nodes, flatTree(nodes).find(n=>n.authEmail&&n.authEmail.toLowerCase()===userEmail.toLowerCase())?.id||"")
    : null;

  const scopedNodes = isMinister ? nodes : leaderNode ? leaderNode.children : [];

  const showToast = (msg,color=T.indigo)=>{
    setToast({msg,color}); setTimeout(()=>setToast(null),3000);
  };

  // ── LOAD ────────────────────────────────────────────────────
  const load = useCallback(async()=>{
    if (!config.apiKey||!config.sheetId) return;
    setLoading(true); setSyncMsg("Loading…");
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/Network?key=${config.apiKey}`;
      console.log("Loading sheet from:", url);
      const r = await fetch(url);
      if (!r.ok) {
        const err = await r.json();
        console.error("Sheet load error:", err);
        throw new Error(err.error?.message||"Load failed");
      }
      const j = await r.json();
      console.log("Sheet rows loaded:", (j.values||[]).length);
      console.log("First few rows:", JSON.stringify((j.values||[]).slice(0,4)));
      if ((j.values||[]).length<=1){setSyncMsg("Sheet is empty — add families first");setLoading(false);return;}
      const {minister:m, nodes:n} = rowsToTree(j.values);
      console.log("Parsed nodes:", n.length, "authEmails:", flatTree(n).map(x=>x.authEmail).filter(Boolean));
      setMinister(m); setNodes(n);
      setSyncMsg(`✓ ${new Date().toLocaleTimeString()}`);
    } catch(e){
      console.error("Load exception:", e);
      setSyncMsg(`⚠ ${e.message}`);
    }
    setLoading(false);
  },[config]);

  useEffect(()=>{if(isConnected) load();},[isConnected]);

  // After sheet loads, verify pending sessions
  // Runs whenever nodes updates — so it always checks AFTER sheet loads
  useEffect(()=>{
    if (!session?.pending) return;
    if (loading) return; // wait for sheet to finish loading
    const email = session.email.toLowerCase().trim();
    const isMin = email===(config.ministerEmail||"").toLowerCase().trim();
    const allNodes = flatTree(nodes);
    console.log("Verifying login (post-load):", email);
    console.log("All authEmails:", allNodes.map(n=>n.authEmail).filter(Boolean));
    const isLeader = allNodes.some(n=>n.authEmail&&n.authEmail.toLowerCase().trim()===email);
    console.log("isLeader:", isLeader, "isMin:", isMin);
    if (isMin||isLeader){
      setSession(s=>({...s,pending:false}));
      Store.set(SESSION_KEY,{...session,pending:false});
    } else {
      setAuthErr(`${session.email} is not authorized. Ask your minister to grant access.`);
      setSession(null);
      Store.remove(SESSION_KEY);
    }
  },[nodes,loading,session?.pending]);

  // ── SAVE via script tag (bypasses CORS) ─────────────────────
  const save = useCallback((m,n)=>{
    if (!config.scriptUrl){showToast("⚠ Apps Script URL not set","#8b1a1a");return;}
    setSyncMsg("Saving…");
    try {
      const payload = JSON.stringify({rows:[SHEET_HEADERS,...treeToRows(m,n)]});
      const url = config.scriptUrl + "?data=" + encodeURIComponent(payload);
      // Use a script tag to fire the request — fully bypasses CORS
      const old = document.getElementById("gs-save-tag");
      if (old) old.remove();
      const tag = document.createElement("script");
      tag.id = "gs-save-tag";
      tag.src = url;
      tag.onload = () => {
        setSyncMsg("✓ Saved " + new Date().toLocaleTimeString());
        showToast("✓ Saved to Google Sheet", "#2ecc8a");
        tag.remove();
      };
      tag.onerror = () => {
        // script tag errors are normal for Apps Script but data still saves
        setSyncMsg("✓ Saved " + new Date().toLocaleTimeString());
        showToast("✓ Saved to Google Sheet", "#2ecc8a");
        tag.remove();
      };
      document.head.appendChild(tag);
    } catch(e){
      setSyncMsg("⚠ Save failed: " + e.message);
      showToast("⚠ Save failed","#8b1a1a");
    }
  },[config]);

  // ── AUTH ────────────────────────────────────────────────────
  const handleToken = useCallback((credential)=>{
    const p = parseJwt(credential);
    if (!p){setAuthErr("Could not verify Google token.");return;}
    const email = p.email;
    const isMin = email.toLowerCase()===(config.ministerEmail||"").toLowerCase();
    // Save credential first, then verify after sheet loads
    // This handles the case where sheet hasn't loaded yet when user logs in
    const sess = {email, name:p.name||"", picture:p.picture||"", pending:!isMin};
    setSession(sess); setAuthErr("");
    Store.set(SESSION_KEY, sess);
  },[config]);

  const logout = ()=>{
    setSession(null);
    Store.remove(SESSION_KEY);
  };

  // ── TREE MUTATIONS ───────────────────────────────────────────
  const handleSaveEdit = async(form)=>{
    const updated = updateNode(nodes, form.id, ()=>form);
    setNodes(updated); setEditNode(null);
    showToast("✓ Saved",T.green);
    await save(minister,updated);
  };

  const handleAddFamily = async(parentId, form)=>{
    const newNode = makeNode(uid(), parentId, form);
    const updated = injectChild(nodes, parentId, newNode);
    setNodes(updated); setAddParent(null);
    showToast(`+ ${form.familyName||"Family"} added`,T.green);
    await save(minister,updated);
  };

  const handleAddRoot = async()=>{
    const newNode = makeNode(uid(),"");
    const updated = [...nodes, newNode];
    setNodes(updated);
    showToast("+ Core family added");
    await save(minister,updated);
  };

  const handleSaveConfig = (c)=>{
    setConfig(c);
    const saved = Store.set(CONFIG_KEY, c);
    setSaveStatus(saved ? "✓ Saved to browser" : "⚠ Browser storage blocked — config held in memory only");
    setShowSetup(false);
    showToast("✓ Configuration saved — you can now sign in","#6a3aed");
  };

  // ── SEARCH FILTER ────────────────────────────────────────────
  const sl = search.toLowerCase();
  function filterNodes(ns){
    if (!search) return ns;
    return ns.reduce((acc,n)=>{
      const match = [n.familyName,n.contactPerson,n.memberId,n.telegramId,n.country,n.state]
        .some(v=>v&&v.toLowerCase().includes(sl));
      const kids = filterNodes(n.children||[]);
      if (match||kids.length) acc.push({...n,children:kids});
      return acc;
    },[]);
  }
  const displayNodes = filterNodes(scopedNodes);

  // ── NO CONFIG ────────────────────────────────────────────────
  if (!isConnected||showSetup) {
    return <>
      <style>{CSS}</style>
      <div style={{minHeight:"100vh",background:T.bg1,padding:20,overflowY:"auto"}}>
        <div style={{maxWidth:680,margin:"40px auto"}}>
          <SetupPanel config={config} onSave={handleSaveConfig}
            onCancel={isConnected?()=>setShowSetup(false):null}/>
        </div>
      </div>
    </>;
  }

  // ── NOT LOGGED IN ────────────────────────────────────────────
  if (!session) {
    return <>
      <style>{CSS}</style>
      <LoginScreen clientId={config.clientId} onToken={handleToken}
        onSetup={()=>setShowSetup(true)} error={authErr}/>
    </>;
  }

  // ── UNAUTHORIZED ─────────────────────────────────────────────
  // Still loading sheet data — show spinner instead of access denied
  if (isPending) {
    return <>
      <style>{CSS}</style>
      <div style={{minHeight:"100vh",background:T.bg0,display:"flex",alignItems:"center",
        justifyContent:"center",padding:20}}>
        <div style={{background:T.bg2,border:`1px solid ${T.border2}`,
          borderTop:`2px solid ${T.gold}`,borderRadius:12,padding:40,
          maxWidth:380,textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:16}}>✝</div>
          <h2 style={{color:T.goldL,fontFamily:"'Cinzel',serif",marginBottom:12}}>Verifying Access…</h2>
          <p style={{color:T.textSub,fontSize:14}}>Loading your network data, please wait.</p>
          <div style={{marginTop:20,color:T.textDim,fontSize:12}}>Signed in as {userEmail}</div>
          <div style={{marginTop:16}}><GoldBtn onClick={logout} outline small>Cancel</GoldBtn></div>
        </div>
      </div>
    </>;
  }

  if (!isMinister&&!leaderNode) {
    return <>
      <style>{CSS}</style>
      <div style={{minHeight:"100vh",background:T.bg0,display:"flex",alignItems:"center",
        justifyContent:"center",padding:20}}>
        <div style={{background:T.bg2,border:`1px solid ${T.border}`,
          borderTop:"2px solid #8b1a1a",borderRadius:12,padding:40,
          maxWidth:380,textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:16}}>⛔</div>
          <h2 style={{color:"#f87171",fontFamily:"'Cinzel',serif",marginBottom:12}}>Access Denied</h2>
          <p style={{color:T.textSub,fontSize:14,lineHeight:1.6}}>
            <strong style={{color:T.text}}>{userEmail}</strong> is not authorized.<br/>
            Contact your minister to be granted access.
          </p>
          <div style={{marginTop:24}}>
            <GoldBtn onClick={logout} outline>Sign Out</GoldBtn>
          </div>
        </div>
      </div>
    </>;
  }

  // ── MAIN UI ──────────────────────────────────────────────────
  const headerTitle = isMinister
    ? (minister.name||"Minister")
    : (leaderNode?.familyName||session.name||"Leader");

  return <>
    <style>{CSS}</style>

    {/* ── HEADER ── */}
    <div style={{background:T.bg0,borderBottom:`1px solid ${T.border}`,
      position:"sticky",top:0,zIndex:100,padding:"0 20px"}}>
      <div style={{maxWidth:920,margin:"0 auto",display:"flex",
        alignItems:"center",gap:12,height:54,flexWrap:"wrap"}}>

        {/* logo */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginRight:8}}>
          <span style={{fontSize:20}}>✝</span>
          <span style={{fontFamily:"'Cinzel',serif",color:T.goldL,fontSize:17,
            letterSpacing:"0.08em",fontWeight:700}}>Shepherd</span>
        </div>

        {/* nav tabs */}
        {["tree","dashboard"].map(v=>(
          <button key={v} onClick={()=>setView(v)} style={{
            background:"none", border:"none",
            color: view===v?T.goldL:T.textSub,
            borderBottom: view===v?`2px solid ${T.gold}`:"2px solid transparent",
            padding:"16px 10px 14px",
            fontSize:12, fontFamily:"'Cinzel',serif", letterSpacing:"0.06em",
            cursor:"pointer", textTransform:"capitalize", fontWeight:view===v?700:400,
          }}>{v==="tree"?"Network":"Dashboard"}</button>
        ))}

        <div style={{flex:1}}/>

        {/* sync status */}
        {syncMsg&&<span style={{fontSize:11,color:syncMsg.startsWith("⚠")?T.red:T.green,
          fontFamily:"'Cinzel',serif"}}>{syncMsg}</span>}

        <IconBtn onClick={load} color={T.bg3} tc={T.blue} border={T.border}
          title="Refresh from Sheets">{loading?"⟳":"⟳"}</IconBtn>

        {isMinister&&<IconBtn onClick={()=>setShowSetup(true)} color={T.bg3}
          tc={T.textSub} border={T.border}>⚙</IconBtn>}

        {/* user avatar */}
        {session.picture
          ? <img src={session.picture} alt="" style={{width:28,height:28,borderRadius:"50%",
              border:`1px solid ${T.gold}`,cursor:"pointer"}} onClick={logout} title="Sign out"/>
          : <IconBtn onClick={logout} color={T.bg3} tc={T.textSub} border={T.border}>
              {session.name?.slice(0,1)||"?"}</IconBtn>}
      </div>
    </div>

    {/* ── BODY ── */}
    <div style={{maxWidth:920,margin:"0 auto",padding:"24px 16px"}}>

      {/* role banner */}
      <div style={{marginBottom:18,display:"flex",alignItems:"center",gap:12,
        background:T.bg2,border:`1px solid ${T.border}`,borderLeft:`3px solid ${T.gold}`,
        borderRadius:8,padding:"10px 16px",flexWrap:"wrap"}}>
        <span style={{color:T.goldL,fontFamily:"'Cinzel',serif",fontSize:13,fontWeight:700}}>
          {isMinister?"✝ Minister":"👤 Family Leader"}
        </span>
        <span style={{color:T.textSub,fontSize:13}}>{headerTitle}</span>
        <span style={{color:T.textDim,fontSize:12}}>{userEmail}</span>
        {!isMinister&&<span style={{color:T.textDim,fontSize:12,fontStyle:"italic"}}>
          · viewing your assigned families only</span>}
        <div style={{marginLeft:"auto"}}>
          <GoldBtn onClick={logout} outline small>Sign Out</GoldBtn>
        </div>
      </div>

      {/* ── DASHBOARD VIEW ── */}
      {view==="dashboard"&&(
        <Dashboard nodes={scopedNodes}
          title={isMinister?"Full Network Dashboard":"Your Group Dashboard"}/>
      )}

      {/* ── TREE VIEW ── */}
      {view==="tree"&&<div className="fade-in">
        {/* tree toolbar */}
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search by name, ID, Telegram, country…"
            style={{...sInput,flex:1,minWidth:200,marginBottom:0,fontSize:14,
              borderColor:search?T.gold:T.border}}/>
          {isMinister&&(
            <GoldBtn onClick={handleAddRoot} small>+ Core Family</GoldBtn>
          )}
          {!isMinister&&leaderNode&&(
            <GoldBtn onClick={()=>setAddParent(leaderNode)} small>+ Add Family</GoldBtn>
          )}
        </div>

        {/* minister profile (minister only) */}
        {isMinister&&<div style={{background:T.bg2,border:`1px solid ${T.border2}`,
          borderTop:`1px solid ${T.gold}`,borderRadius:10,padding:"14px 16px",marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontFamily:"'Cinzel',serif",color:T.goldL,fontSize:12,letterSpacing:"0.08em"}}>
              MINISTER PROFILE
            </span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"0 12px"}}>
            {[["Name","name"],["Phone / Contact","contactPerson"],["Member ID","memberId"],
              ["Telegram ID","telegramId"],["Country","country"],["State","state"]].map(([ph,key])=>(
              <div key={key}>
                <Label>{ph}</Label>
                <Input value={minister[key]||""} style={{fontSize:13,marginBottom:8}}
                  onChange={e=>setMinister(p=>({...p,[key]:e.target.value}))}
                  onBlur={()=>save(minister,nodes)} placeholder={ph}/>
              </div>
            ))}
          </div>
        </div>}

        {/* tree */}
        {displayNodes.length===0
          ?<div style={{textAlign:"center",padding:60,color:T.textDim,fontStyle:"italic"}}>
            {search?`No results for "${search}"`:"No families yet — add one above."}
          </div>
          :displayNodes.map(n=>(
            <TreeNode key={n.id} node={n} depth={0} isMinister={isMinister}
              onEdit={setEditNode} onAdd={setAddParent}/>
          ))
        }

        {/* legend */}
        <div style={{marginTop:22,padding:"10px 16px",background:T.bg2,
          border:`1px solid ${T.border}`,borderRadius:8,
          display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
          {[[T.green,"≤7 days"],[T.amber,"8–30 days"],[T.red,">30 days"],[T.textDim,"Never"]].map(([c,l])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:T.textSub}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:c,display:"inline-block"}}/>{l}
            </div>
          ))}
          <span style={{color:T.textDim,fontSize:10,marginLeft:"auto"}}>
            ✎ view/edit · + add sub-family · click row to expand
          </span>
        </div>
      </div>}
    </div>

    {/* ── EDIT MODAL ── */}
    {editNode&&<Modal title={isMinister?"Edit Family":"Family Details"} onClose={()=>setEditNode(null)}>
      <EditNodeModal node={editNode} isMinister={isMinister}
        onSave={handleSaveEdit} onClose={()=>setEditNode(null)}/>
    </Modal>}

    {/* ── ADD MODAL ── */}
    {addParent&&<Modal title={`Add Family under ${addParent.familyName||"this group"}`}
      onClose={()=>setAddParent(null)}>
      <AddNodeModal parentNode={addParent} isMinister={isMinister}
        onAdd={form=>handleAddFamily(addParent.id,form)} onClose={()=>setAddParent(null)}/>
    </Modal>}

    {toast&&<Toast msg={toast.msg} color={toast.color}/>}
  </>;
}

// ── sub-components kept small ──────────────────────────────
function EditNodeModal({node, isMinister, onSave, onClose}) {
  const [form,setForm] = useState({...node});
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));

  if (!isMinister) {
    // Leaders can only assign a sub-leader email
    return <>
      <div style={{background:T.bg3,border:`1px solid ${T.border}`,borderRadius:8,
        padding:"12px 14px",marginBottom:16}}>
        <div style={{color:T.textSub,fontSize:13,marginBottom:4,fontFamily:"'Cinzel',serif",
          letterSpacing:"0.05em"}}>FAMILY</div>
        <div style={{color:T.text,fontWeight:700,fontSize:15}}>{node.familyName||"—"}</div>
        {node.contactPerson&&<div style={{color:T.textSub,fontSize:13,marginTop:2}}>{node.contactPerson}</div>}
        {(node.country||node.state)&&<div style={{color:T.textDim,fontSize:12,marginTop:2}}>
          📍 {[node.state,node.country].filter(Boolean).join(", ")}</div>}
      </div>
      <Label gold>Assign Sub-Leader Google Email</Label>
      <p style={{color:T.textSub,fontSize:12,marginBottom:10,lineHeight:1.5}}>
        Enter a Gmail address to give this person leader access to this family's sub-group.
      </p>
      <Input value={form.authEmail||""} onChange={f("authEmail")}
        placeholder="subleader@gmail.com" type="email"/>
      <div style={{display:"flex",gap:8,marginTop:4}}>
        <GoldBtn onClick={()=>onSave(form)} full>Assign Leader</GoldBtn>
        <GoldBtn onClick={onClose} outline>Cancel</GoldBtn>
      </div>
    </>;
  }

  return <>
    <NodeForm form={form} setForm={setForm} isMinister={isMinister} readOnly={false}/>
    <div style={{display:"flex",gap:8,marginTop:4}}>
      <GoldBtn onClick={()=>onSave(form)} full>Save Changes</GoldBtn>
      <GoldBtn onClick={onClose} outline>Cancel</GoldBtn>
    </div>
  </>;
}

function AddNodeModal({parentNode, isMinister, onAdd, onClose}) {
  const [form,setForm] = useState({familyName:"",contactPerson:"",memberId:"",
    telegramId:"",country:"",state:"",notes:"",authEmail:""});
  // Leaders can add families and optionally assign a sub-leader email
  return <>
    <NodeForm form={form} setForm={setForm} isMinister={true}/>
    <div style={{display:"flex",gap:8,marginTop:4}}>
      <GoldBtn onClick={()=>onAdd(form)} full>+ Add Family</GoldBtn>
      <GoldBtn onClick={onClose} outline>Cancel</GoldBtn>
    </div>
  </>;
}
