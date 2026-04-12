import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase, POLL_FUNCTION_URL } from './supabase';
import './App.css';

const CATEGORY_COLORS = {
  football: '#CF2B1F', baseball: '#1E5C3A', basketball: '#F58426',
  pokemon: '#FFCB05', sports: '#3B82F6', 'one-piece': '#E4002B',
  other: '#8B5CF6', comic: '#A855F7', mtg: '#6B21A8', watch: '#D4AF37',
  soccer: '#22C55E', hockey: '#A5ACAF', wildcard: '#EC4899',
  watches: '#D4AF37', limited_drop: '#F97316', booster: '#8B5CF6',
};

function getValueSignal(ratio) {
  if (ratio >= 1.15) return { label: 'GREAT VALUE', color: '#00FF88', bg: 'rgba(0,255,136,0.12)' };
  if (ratio >= 1.05) return { label: 'GOOD VALUE', color: '#22D3EE', bg: 'rgba(34,211,238,0.12)' };
  if (ratio >= 0.97) return { label: 'FAIR', color: '#FCD34D', bg: 'rgba(252,211,77,0.12)' };
  if (ratio >= 0.93) return { label: 'SLIGHT EDGE TO HOUSE', color: '#FB923C', bg: 'rgba(251,146,60,0.12)' };
  return { label: 'OVERPRICED', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' };
}

function timeAgo(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function Sparkline({ data, width = 80, height = 24, color = '#22D3EE' }) {
  if (!data?.length || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 0.01;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`);
  return <svg width={width} height={height} style={{ display: 'block' }}><polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

function EVChart({ snapshots }) {
  if (!snapshots?.length) return <div className="chart-empty">Collecting data...</div>;
  const data = snapshots.slice(-300);
  const ratios = data.map(s => Number(s.effective_ev_ratio));
  const min = Math.min(...ratios, 0.9), max = Math.max(...ratios, 1.1), range = max - min || 0.1;
  const W = 700, H = 200;
  const points = ratios.map((v, i) => ({ x: 50 + (i / Math.max(ratios.length - 1, 1)) * (W - 70), y: 10 + (1 - (v - min) / range) * (H - 30), v }));
  const breakY = 10 + (1 - (1 - min) / range) * (H - 30);
  const yTicks = Array.from({ length: 5 }, (_, i) => { const val = min + (range / 4) * i; return { val, y: 10 + (1 - (val - min) / range) * (H - 30) }; });
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H + 25}`} className="ev-chart">
      {yTicks.map((t, i) => <g key={i}><line x1={50} x2={W - 10} y1={t.y} y2={t.y} stroke="rgba(255,255,255,0.06)" /><text x={45} y={t.y + 4} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="end">{t.val.toFixed(3)}</text></g>)}
      <line x1={50} x2={W - 10} y1={breakY} y2={breakY} stroke="#EF4444" strokeWidth="1" strokeDasharray="4,3" />
      <text x={W - 8} y={breakY - 4} fill="#EF4444" fontSize="9" textAnchor="end">Break-even 1.000</text>
      <polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#22D3EE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {last && <><circle cx={last.x} cy={last.y} r="4" fill="#22D3EE" /><rect x={last.x + 6} y={last.y - 10} width={50} height={20} rx={4} fill="#22D3EE" /><text x={last.x + 31} y={last.y + 4} fill="#000" fontSize="11" fontWeight="700" textAnchor="middle">{last.v.toFixed(3)}</text></>}
    </svg>
  );
}

function OddsBreakdown({ odds, price }) {
  if (!odds?.buckets) return null;
  const tc = { base: '#6B7280', common: '#22C55E', uncommon: '#3B82F6', rare: '#A855F7', epic: '#F59E0B', chase: '#EF4444' };
  const buckets = odds.bucketDetails || odds.buckets;
  const maxPct = Math.max(...buckets.map(b => b.oddsPercent || b.percent || 0));
  const profitPct = buckets.filter(b => (b.minValueUsd || 0) >= price || (b.rawMidpoint || 0) >= price).reduce((s, b) => s + (b.oddsPercent || b.percent || 0), 0);
  return (
    <div className="odds-section">
      <div className="section-hdr"><span>Calibrated Odds</span><span className="profit-zone">{profitPct.toFixed(1)}% profit zone</span></div>
      {buckets.map((b, i) => {
        const pct = b.oddsPercent || b.percent || 0;
        const tier = b.tier || b.t || 'common';
        const label = b.label || `$${b.minValueUsd}-$${b.maxValueUsd}`;
        const mid = b.calibratedMidpoint || b.rawMidpoint || ((b.minValueUsd + b.maxValueUsd) / 2);
        const pullCount = b.pullCount;
        return (
          <div key={i} className="odds-row">
            <div className="odds-top">
              <span style={{ color: tc[tier], fontWeight: 600, textTransform: 'capitalize' }}>{tier}</span>
              <span className="dim">{label}</span>
              <span className="dim" style={{ marginLeft: 'auto' }}>{pct}%</span>
            </div>
            <div className="bar-bg"><div className="bar-fill" style={{ width: `${(pct / maxPct) * 100}%`, background: tc[tier] }} /></div>
            <div className="odds-mid">
              mid: ${mid?.toFixed(2)}
              {pullCount != null && ` (${pullCount} pulls)`}
            </div>
          </div>
        );
      })}
      <div className="pl-section">
        <div className="pl-bar"><div className="pl-loss" style={{ width: `${100 - profitPct}%` }} /><div className="pl-win" /></div>
        <div className="pl-labels"><span>Loss / Break-even ({(100 - profitPct).toFixed(1)}%)</span><span>Profit ({profitPct.toFixed(1)}%)</span></div>
      </div>
    </div>
  );
}

function PullItem({ pull, packTitle, onPackClick }) {
  const tc = { base: '#6B7280', common: '#22C55E', uncommon: '#3B82F6', rare: '#A855F7', epic: '#F59E0B', chase: '#EF4444' };
  return (
    <div className="pull-item" onClick={() => onPackClick && onPackClick(pull.pack_id)} style={{ cursor: onPackClick ? 'pointer' : 'default' }}>
      {pull.image_url ? <img src={pull.image_url} alt="" className="pull-img" /> : <div className="pull-img-ph" />}
      <div className="pull-info">
        <div className="pull-title">{pull.title}</div>
        <div className="pull-meta">
          <span className="pull-tier" style={{ background: tc[pull.tier] || '#22C55E' }}>{pull.tier}</span>
          {pull.buyback_usd && <span className="pull-fmv">${Number(pull.buyback_usd).toFixed(2)}</span>}
          <span className="pull-time">{timeAgo(pull.detected_at)}</span>
        </div>
        {packTitle && <div className="pull-pack-name">{packTitle}</div>}
      </div>
    </div>
  );
}

export default function App() {
  const [packs, setPacks] = useState([]);
  const [snapshots, setSnapshots] = useState({});
  const [pulls, setPulls] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [catFilter, setCatFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('ev');
  const [lastPolled, setLastPolled] = useState(null);
  const [isLive, setIsLive] = useState(false);
  const [pollInfo, setPollInfo] = useState('');
  const [packPulls, setPackPulls] = useState([]);
  const tickRef = useRef(0);
  const lastPollTrigger = useRef(0);

  // Pack ID -> title lookup
  const packTitleMap = useMemo(() => {
    const m = {};
    packs.forEach(p => { m[p.id] = p.title; });
    return m;
  }, [packs]);

  const fetchData = useCallback(async () => {
    try {
      const [{ data: pd }, { data: sd }, { data: pld }] = await Promise.all([
        supabase.from('pack_config').select('*').eq('active', true),
        supabase.from('live_snapshots').select('pack_id, effective_ev_ratio, calibrated_ev_usd, inventory_count, out_of_stock, polled_at, price_usd, real_avg_pull_value, total_cumulative_pulls').gte('polled_at', new Date(Date.now() - 2 * 3600000).toISOString()).order('polled_at', { ascending: true }),
        supabase.from('pulls').select('*').order('detected_at', { ascending: false }).limit(50),
      ]);
      if (pd) {
        const latest = {};
        for (const s of sd || []) latest[s.pack_id] = s;
        setPacks(pd.map(p => {
          const snap = latest[p.id];
          const r = snap ? Number(snap.effective_ev_ratio) : 0;
          return {
            ...p, evRatio: r, signal: getValueSignal(r),
            realAvgPull: snap ? Number(snap.real_avg_pull_value) : 0,
            totalPulls: snap ? Number(snap.total_cumulative_pulls) : 0,
          };
        }));
      }
      if (sd) {
        const g = {};
        for (const s of sd) { if (!g[s.pack_id]) g[s.pack_id] = []; g[s.pack_id].push(s); }
        setSnapshots(g);
      }
      if (pld) setPulls(pld);
      setLastPolled(new Date());
      setIsLive(true);
    } catch (e) { console.error(e); }
  }, []);

  const triggerPoll = useCallback(async () => {
    try {
      setPollInfo('polling...');
      const r = await fetch(POLL_FUNCTION_URL, { method: 'POST' });
      const d = await r.json();
      setPollInfo(`${d.pulldHits || 0}/${d.packs}p synced | ${d.pulls} new pulls`);
      tickRef.current++;
      await fetchData();
    } catch { setPollInfo('error'); }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    // Poll edge function every 15s (not 5s — too aggressive for 61 pack fetches)
    triggerPoll();
    const pollTimer = setInterval(triggerPoll, 15000);
    // Refresh UI from Supabase every 5s
    const uiTimer = setInterval(fetchData, 5000);
    return () => { clearInterval(pollTimer); clearInterval(uiTimer); };
  }, [fetchData, triggerPoll]);

  // Fetch pulls for selected pack
  useEffect(() => {
    if (!selectedId) { setPackPulls([]); return; }
    const fetchPackPulls = async () => {
      const { data } = await supabase
        .from('pulls').select('*')
        .eq('pack_id', selectedId)
        .order('detected_at', { ascending: false })
        .limit(50);
      if (data) setPackPulls(data);
    };
    fetchPackPulls();
    const interval = setInterval(fetchPackPulls, 5000);
    return () => clearInterval(interval);
  }, [selectedId]);

  const categories = useMemo(() => {
    const c = {};
    packs.forEach(p => { if (p.evRatio > 0) c[p.category] = (c[p.category] || 0) + 1; });
    return c;
  }, [packs]);

  const filtered = useMemo(() => {
    let l = catFilter === 'ALL' ? packs : packs.filter(p => p.category === catFilter);
    l = l.filter(p => p.evRatio > 0);
    l.sort((a, b) => sortBy === 'ev' ? b.evRatio - a.evRatio : Number(a.price_usd) - Number(b.price_usd));
    return l;
  }, [packs, catFilter, sortBy]);

  const sel = packs.find(p => p.id === selectedId);
  const best = filtered[0];

  const handlePullClick = useCallback((packId) => {
    if (packId) setSelectedId(packId);
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="h-left">
          <span className="logo">SLAB TRACKER</span>
          <div className={`live-tag ${isLive ? 'on' : ''}`}><span className="dot" /><span>LIVE FEED</span></div>
          {lastPolled && <span className="upd">Updated {timeAgo(lastPolled.toISOString())}</span>}
          {pollInfo && <span className="poll-info">{pollInfo}</span>}
        </div>
        <div className="h-right">
          <a href="https://courtyard.io/vending-machine" target="_blank" rel="noreferrer" className="open-btn">OPEN PACK</a>
        </div>
      </header>

      <div className="cat-bar">
        <button className={`cb ${catFilter === 'ALL' ? 'ac' : ''}`} onClick={() => setCatFilter('ALL')}>ALL {packs.filter(p => p.evRatio > 0).length}</button>
        {Object.entries(categories).sort().map(([c, n]) => <button key={c} className={`cb ${catFilter === c ? 'ac' : ''}`} onClick={() => setCatFilter(c)}>{c.toUpperCase().replace('-', ' ')} {n}</button>)}
      </div>

      {best && !sel && (
        <div className="hero">
          <div className="hero-lbl">🔥 BEST VALUE RIGHT NOW</div>
          <div className="hero-card" onClick={() => setSelectedId(best.id)} style={{ borderColor: `${CATEGORY_COLORS[best.category] || '#333'}44` }}>
            <div className="hero-top">
              <div><div className="hero-title">{best.title}</div>
                <div className="hero-sigs"><span className="sig" style={{ color: best.signal.color, background: best.signal.bg }}>{best.signal.label}</span><span className="dim">${Number(best.price_usd).toFixed(0)} per pull</span></div></div>
              <div className="hero-ev"><div className="hero-ev-n">{best.evRatio.toFixed(3)}</div><div className="hero-ev-l">EV RATIO</div></div>
            </div>
            <div className="sg">
              <div className="sc"><div className="sl">PACK PRICE</div><div className="sv">${Number(best.price_usd).toFixed(0)}</div></div>
              <div className="sc"><div className="sl">CALIBRATED EV</div><div className="sv cy">${(best.evRatio * Number(best.price_usd)).toFixed(2)}</div></div>
              <div className="sc"><div className="sl">REAL AVG PULL</div><div className="sv">${best.realAvgPull ? best.realAvgPull.toFixed(2) : '—'}</div>
                {best.realAvgPull > 0 && <div className={`sd ${best.realAvgPull >= Number(best.price_usd) ? 'pos' : 'neg'}`}>{best.realAvgPull >= Number(best.price_usd) ? '+' : ''}${(best.realAvgPull - Number(best.price_usd)).toFixed(2)} vs price</div>}</div>
              <div className="sc"><div className="sl">TOTAL PULLS</div><div className="sv">{best.totalPulls ? best.totalPulls.toLocaleString() : '—'}</div></div>
            </div>
          </div>
        </div>
      )}

      {sel && (
        <div className="detail">
          <button className="back" onClick={() => setSelectedId(null)}>← Back to all packs</button>
          <div className="det-card" style={{ borderColor: `${CATEGORY_COLORS[sel.category] || '#333'}44` }}>
            <div className="det-hdr">
              <div><div className="det-title">{sel.title}</div><div className="det-sigs"><span className="sig" style={{ color: sel.signal.color, background: sel.signal.bg }}>{sel.signal.label}</span><span className="dim">{sel.out_of_stock ? 'OUT OF STOCK' : 'IN STOCK'}</span></div></div>
              <div className="det-ev"><div className="det-ev-n">{sel.evRatio.toFixed(3)}</div><div className="det-ev-l">EV RATIO</div></div>
            </div>
            <div className="sg">
              <div className="sc"><div className="sl">PACK PRICE</div><div className="sv">${Number(sel.price_usd).toFixed(0)}</div></div>
              <div className="sc"><div className="sl">CALIBRATED EV</div><div className="sv cy">${(sel.evRatio * Number(sel.price_usd)).toFixed(2)}</div></div>
              <div className="sc"><div className="sl">REAL AVG PULL</div><div className="sv">${sel.realAvgPull ? sel.realAvgPull.toFixed(2) : '—'}</div></div>
              <div className="sc"><div className="sl">TOTAL PULLS</div><div className="sv">{sel.totalPulls ? sel.totalPulls.toLocaleString() : '—'}</div>
                <div className="stat-sub">{sel.inventory_count} in inventory</div></div>
            </div>
            <div className="chart-sec">
              <div className="section-hdr"><span>EV Ratio</span><span className="cy">{sel.evRatio.toFixed(3)}</span></div>
              <div className="chart-wrap"><EVChart snapshots={snapshots[sel.id] || []} /></div>
            </div>
            <OddsBreakdown odds={sel.odds} price={Number(sel.price_usd)} />

            <div className="det-pulls">
              <div className="section-hdr">
                <div className="feed-t"><span>🔥</span> Just Pulled</div>
                <div className="live-sm"><span className="dot-sm" /><span>live</span></div>
              </div>
              <div className="det-pull-list">
                {packPulls.length === 0 ? (
                  <div className="empty-p">Monitoring for pulls on this pack...</div>
                ) : (
                  packPulls.map(p => <PullItem key={p.id} pull={p} />)
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!sel && (
        <div className="main">
          <div className="pack-list">
            <div className="list-hdr"><span>All Packs</span><div className="sorts"><button className={`sb ${sortBy === 'ev' ? 'ac' : ''}`} onClick={() => setSortBy('ev')}>EV Ratio</button><button className={`sb ${sortBy === 'price' ? 'ac' : ''}`} onClick={() => setSortBy('price')}>Price</button></div></div>
            <div className="tbl-hdr"><span className="c1">#</span><span className="c2">PACK</span><span className="c3">EV RATIO</span><span className="c4">PRICE</span><span className="c5">EV $</span><span className="c6">PULLS</span><span className="c7">SIGNAL</span></div>
            <div className="rows">
              {filtered.map((p, i) => (
                <div key={p.id} className="row" onClick={() => setSelectedId(p.id)}>
                  <span className="c1">#{i + 1}</span>
                  <div className="c2"><div className="rn">{p.title}</div><div className="rm"><span className="cd" style={{ background: CATEGORY_COLORS[p.category] || '#666' }} /><span className="dim">CY</span>{p.out_of_stock && <span className="oos">OOS</span>}</div></div>
                  <div className="c3"><span className="ev-n">{p.evRatio.toFixed(3)}</span><Sparkline data={(snapshots[p.id] || []).map(s => Number(s.effective_ev_ratio))} width={40} height={16} color={p.evRatio >= 1 ? '#22C55E' : '#EF4444'} /></div>
                  <span className="c4">${Number(p.price_usd).toFixed(0)}</span>
                  <span className="c5 cy">${(p.evRatio * Number(p.price_usd)).toFixed(2)}</span>
                  <span className="c6">{p.totalPulls ? p.totalPulls.toLocaleString() : '—'}</span>
                  <span className="c7"><span className="sig-sm" style={{ color: p.signal.color, background: p.signal.bg }}>{p.signal.label}</span></span>
                </div>
              ))}
              {!filtered.length && <div className="empty">Loading packs...</div>}
            </div>
          </div>
          <div className="feeds">
            <div className="feed-hdr"><div className="feed-t"><span>🔥</span> Just Pulled</div><div className="live-sm"><span className="dot-sm" /><span>live</span></div></div>
            <div className="pull-list">
              {!pulls.length ? <div className="empty-p"><div>Monitoring for pulls...</div></div> : pulls.map(p => <PullItem key={p.id} pull={p} packTitle={packTitleMap[p.pack_id]} onPackClick={handlePullClick} />)}
            </div>
          </div>
        </div>
      )}

      <footer className="foot">This tool is for educational and informational purposes only. Not financial advice. Pack outcomes are random.</footer>
    </div>
  );
}
