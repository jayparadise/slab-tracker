import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase, POLL_FUNCTION_URL } from './supabase';
import './App.css';

const TIER_COLORS = { base: '#6B7280', common: '#6B7280', uncommon: '#22C55E', rare: '#3B82F6', epic: '#A855F7', chase: '#F97316', grail: '#DC2626' };
const CATEGORY_COLORS = {
  football:'#CF2B1F',baseball:'#1E5C3A',basketball:'#F58426',pokemon:'#FFCB05',sports:'#3B82F6',
  'one-piece':'#E4002B',other:'#8B5CF6',comic:'#A855F7',mtg:'#6B21A8',watch:'#D4AF37',
  soccer:'#22C55E',hockey:'#A5ACAF',wildcard:'#EC4899',watches:'#D4AF37',
};
const SPORTS_CATS = new Set(['football','baseball','basketball','sports','soccer','hockey']);
function isSports(cat) { return SPORTS_CATS.has(cat); }

// Map Courtyard's raw tier names to display names based on bucket count
const TIER_MAP_5 = ['common','uncommon','rare','epic','chase'];
const TIER_MAP_6 = ['common','uncommon','rare','epic','chase','grail'];
function displayTier(rawTier, bucketIndex, totalBuckets) {
  if (totalBuckets === 5) return TIER_MAP_5[bucketIndex] || rawTier;
  if (totalBuckets === 6) return TIER_MAP_6[bucketIndex] || rawTier;
  if (totalBuckets === 4) return ['common','rare','epic','chase'][bucketIndex] || rawTier;
  if (totalBuckets === 3) return ['common','rare','chase'][bucketIndex] || rawTier;
  return rawTier;
}
// For pull items, map based on what we know
function displayPullTier(rawTier, odds) {
  if (!odds?.buckets) return rawTier;
  const n = odds.buckets.length;
  const idx = odds.buckets.findIndex(b => b.tier === rawTier);
  if (idx === -1) return rawTier;
  return displayTier(rawTier, idx, n);
}

// Cold streak: count pulls since last "rare+" (bucket index >= 2)
function getColdStreak(pulls, odds) {
  if (!pulls.length || !odds?.buckets) return null;
  const rareTiers = new Set(odds.buckets.slice(2).map(b => b.tier));
  let sinceRare = 0;
  for (const p of pulls) {
    if (rareTiers.has(p.tier)) break;
    sinceRare++;
  }
  // Expected pulls between rares: 100 / sum(odds of rare+ tiers)
  const rareOdds = odds.buckets.slice(2).reduce((s, b) => s + (b.oddsPercent || 0), 0);
  const expected = rareOdds > 0 ? Math.round(100 / rareOdds) : 20;
  return { sinceRare, expected, rareOdds };
}

function getValueSignal(r){
  if(r>=1.20)return{label:'GREAT VALUE',color:'#16A34A',bg:'rgba(22,163,74,0.1)'};
  if(r>=1.10)return{label:'GOOD VALUE',color:'#334155',bg:'rgba(51,65,85,0.08)'};
  if(r>=1.00)return{label:'FAIR',color:'#A16207',bg:'rgba(161,98,7,0.08)'};
  if(r>=0.90)return{label:'BELOW AVERAGE',color:'#C2410C',bg:'rgba(194,65,12,0.08)'};
  return{label:'OVERPRICED',color:'#DC2626',bg:'rgba(220,38,38,0.08)'};
}
function timeAgo(d){const s=Math.floor((Date.now()-new Date(d).getTime())/1000);if(s<5)return'just now';if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;return`${Math.floor(s/3600)}h ago`;}

function Sparkline({data,width=80,height=24,color='#22D3EE'}){
  if(!data?.length||data.length<2)return null;
  const mn=Math.min(...data),mx=Math.max(...data),r=mx-mn||0.01;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*width},${height-((v-mn)/r)*(height-4)-2}`);
  return <svg width={width} height={height} style={{display:'block'}}><polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round"/></svg>;
}

const TIME_RANGES=[{label:'5m',ms:5*60e3},{label:'15m',ms:15*60e3},{label:'1h',ms:60*60e3},{label:'4h',ms:4*60*60e3},{label:'1D',ms:24*60*60e3},{label:'ALL',ms:Infinity}];

function EVChart({snapshots,timeRange}){
  const all=snapshots||[];
  if(!all.length)return<div className="chart-empty">Waiting for data...</div>;
  const rangeMs=TIME_RANGES.find(t=>t.label===timeRange)?.ms||Infinity;
  const cutoff=rangeMs===Infinity?0:Date.now()-rangeMs;
  const inRange=all.filter(s=>new Date(s.polled_at).getTime()>=cutoff);
  // Deduplicate: only keep points where EV changed, plus first and last
  const data=[];
  for(let i=0;i<inRange.length;i++){
    const ev=Number(inRange[i].effective_ev_ratio);
    const prevEv=i>0?Number(inRange[i-1].effective_ev_ratio):null;
    const nextEv=i<inRange.length-1?Number(inRange[i+1].effective_ev_ratio):null;
    if(i===0||i===inRange.length-1||ev!==prevEv||ev!==nextEv)data.push(inRange[i]);
  }
  if(data.length<2)return<div className="chart-empty">Collecting... ({all.length} points, need 2+ in range)</div>;
  const ratios=data.map(s=>Number(s.effective_ev_ratio));
  const mn=Math.min(...ratios),mx=Math.max(...ratios),rng=mx-mn||0.01;
  const padMn=mn-rng*0.1,padMx=mx+rng*0.1,padRng=padMx-padMn;
  const W=700,H=200;
  const pts=ratios.map((v,i)=>({x:50+(i/Math.max(ratios.length-1,1))*(W-70),y:10+(1-(v-padMn)/padRng)*(H-30),v}));
  const breakY=10+(1-(1-padMn)/padRng)*(H-30);
  const yTicks=Array.from({length:5},(_,i)=>{const val=padMn+(padRng/4)*i;return{val,y:10+(1-(val-padMn)/padRng)*(H-30)};});
  const last=pts[pts.length-1];
  const tLabels=[];
  if(data.length>1){const step=Math.max(1,Math.floor(data.length/6));for(let i=0;i<data.length;i+=step){const t=new Date(data[i].polled_at);tLabels.push({x:50+(i/Math.max(data.length-1,1))*(W-70),label:t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})});}}
  return(
    <svg viewBox={`0 0 ${W} ${H+25}`} className="ev-chart">
      {yTicks.map((t,i)=><g key={i}><line x1={50} x2={W-10} y1={t.y} y2={t.y} stroke="rgba(0,0,0,0.06)"/><text x={45} y={t.y+4} fill="rgba(0,0,0,0.35)" fontSize="10" textAnchor="end">{t.val.toFixed(3)}</text></g>)}
      {breakY>0&&breakY<H+20&&<><line x1={50} x2={W-10} y1={breakY} y2={breakY} stroke="#DC2626" strokeWidth="1" strokeDasharray="4,3"/><text x={W-8} y={breakY-4} fill="#DC2626" fontSize="9" textAnchor="end">1.000</text></>}
      <polyline points={pts.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      {last&&<><circle cx={last.x} cy={last.y} r="4" fill="#334155"/><rect x={last.x+6} y={last.y-10} width={50} height={20} rx={4} fill="#334155"/><text x={last.x+31} y={last.y+4} fill="#fff" fontSize="11" fontWeight="700" textAnchor="middle">{last.v.toFixed(3)}</text></>}
      {tLabels.map((t,i)=><text key={i} x={t.x} y={H+18} fill="rgba(0,0,0,0.3)" fontSize="9" textAnchor="middle">{t.label}</text>)}
    </svg>
  );
}

function OddsBreakdown({odds,price,pulls}){
  if(!odds?.buckets)return null;
  const buckets=odds.buckets;
  const n=buckets.length;
  const maxPct=Math.max(...buckets.map(b=>b.oddsPercent||0));
  const profitPct=buckets.filter(b=>(b.minValueUsd||0)>=price).reduce((s,b)=>s+(b.oddsPercent||0),0);
  
  // Count pulls per bucket by FMV range
  const pullCounts=buckets.map(b=>{
    if(!pulls?.length)return 0;
    return pulls.filter(p=>{
      const v=Number(p.value_usd)||0;
      return v>=b.minValueUsd&&v<b.maxValueUsd;
    }).length;
  });
  // Last bucket includes its max
  if(pulls?.length&&buckets.length>0){
    const lastIdx=buckets.length-1;
    pullCounts[lastIdx]=pulls.filter(p=>{
      const v=Number(p.value_usd)||0;
      return v>=buckets[lastIdx].minValueUsd;
    }).length;
  }

  return(
    <div className="odds-section">
      <div className="section-hdr"><span>Odds Breakdown</span><span className="profit-zone">{profitPct.toFixed(1)}% profit zone</span></div>
      {buckets.map((b,i)=>{
        const pct=b.oddsPercent||0;
        const tier=displayTier(b.tier||'common',i,n);
        const mid=((b.minValueUsd||0)+(b.maxValueUsd||0))/2;
        const pc=pullCounts[i];
        return(<div key={i} className="odds-row">
          <div className="odds-top">
            <span style={{color:TIER_COLORS[tier]||'#6B7280',fontWeight:600,textTransform:'capitalize'}}>{tier}</span>
            <span className="dim">${b.minValueUsd}-${b.maxValueUsd}</span>
            <span className="dim" style={{marginLeft:'auto'}}>{pct.toFixed(1)}%</span>
          </div>
          <div className="bar-bg"><div className="bar-fill" style={{width:`${(pct/maxPct)*100}%`,background:TIER_COLORS[tier]||'#6B7280'}}/></div>
          <div className="odds-mid">mid: ${mid.toFixed(2)}{pulls?.length>0?` · ${pc} pulled`:''}</div>
        </div>);
      })}
      <div className="pl-section"><div className="pl-bar"><div className="pl-loss" style={{width:`${100-profitPct}%`}}/><div className="pl-win"/></div>
      <div className="pl-labels"><span>Loss ({(100-profitPct).toFixed(1)}%)</span><span>Profit ({profitPct.toFixed(1)}%)</span></div></div>
    </div>
  );
}

function PullItem({pull,packTitle,onPackClick,odds,evAtPull}){
  const tier = odds ? displayPullTier(pull.tier, odds) : pull.tier;
  return(
    <div className="pull-item" onClick={()=>onPackClick?.(pull.pack_id)}>
      <div className="pull-img-wrap">
        {pull.image_url?<><img src={pull.image_url} alt="" className="pull-img"/><img src={pull.image_url} alt="" className="pull-img-popup"/></>:<div className="pull-img-ph"/>}
      </div>
      <div className="pull-info">
        <div className="pull-title">{pull.title}</div>
        <div className="pull-meta">
          <span className="pull-tier" style={{background:TIER_COLORS[tier]||'#6B7280'}}>{tier}</span>
          {pull.buyback_usd!=null&&Number(pull.buyback_usd)>0&&<span className="pull-fmv">${Number(pull.buyback_usd).toFixed(2)}</span>}
          <span className="pull-time">{timeAgo(pull.detected_at)}</span>
        </div>
        {packTitle&&<div className="pull-pack-name">{packTitle}</div>}
      </div>
      {evAtPull!=null&&<div className="pull-ev">{evAtPull.toFixed(3)}</div>}
    </div>
  );
}

export default function App(){
  const[packs,setPacks]=useState([]);
  const[snapshots,setSnapshots]=useState({});
  const[pulls,setPulls]=useState([]);
  const[selectedId,setSelectedId]=useState(null);
  const[catFilter,setCatFilter]=useState('ALL');
  const[section,setSection]=useState('ALL'); // ALL, SPORTS, COLLECTIBLES
  const[sortBy,setSortBy]=useState('ev');
  const[sortDir,setSortDir]=useState('desc');
  const[lastPolled,setLastPolled]=useState(null);
  const[isLive,setIsLive]=useState(false);
  const[pollInfo,setPollInfo]=useState('');
  const[packPulls,setPackPulls]=useState([]);
  const[chartRange,setChartRange]=useState('ALL');

  const packTitleMap=useMemo(()=>{const m={};packs.forEach(p=>{m[p.id]=p.title;});return m;},[packs]);
  const packCatMap=useMemo(()=>{const m={};packs.forEach(p=>{m[p.id]=p.category;});return m;},[packs]);
  const packOddsMap=useMemo(()=>{const m={};packs.forEach(p=>{m[p.id]=p.odds;});return m;},[packs]);

  const fetchData=useCallback(async()=>{
    try{
      const[{data:pd},{data:latestSnaps},{data:pld}]=await Promise.all([
        supabase.from('pack_config').select('*').eq('active',true),
        supabase.from('live_snapshots').select('pack_id,effective_ev_ratio,calibrated_ev_usd,inventory_count,out_of_stock,polled_at,price_usd,real_avg_pull_value,total_cumulative_pulls').order('polled_at',{ascending:false}).limit(200),
        supabase.from('pulls').select('*').order('detected_at',{ascending:false}).limit(100),
      ]);
      if(pd){
        const latest={};
        for(const s of latestSnaps||[]){if(!latest[s.pack_id])latest[s.pack_id]=s;}
        
        const lastPullMap={};
        const pullsByPack={};
        for(const pl of pld||[]){
          if(!lastPullMap[pl.pack_id])lastPullMap[pl.pack_id]=pl.detected_at;
          if(!pullsByPack[pl.pack_id])pullsByPack[pl.pack_id]=[];
          pullsByPack[pl.pack_id].push(pl);
        }
        
        setPacks(pd.map(p=>{
          const snap=latest[p.id];
          const r=snap?Number(snap.effective_ev_ratio):0;
          const avgPull=snap?Number(snap.real_avg_pull_value||0):0;
          const totalP=snap?Number(snap.total_cumulative_pulls||0):0;
          
          // Compute trend from latest snapshots
          let evTrend=0;
          const packSnaps=(latestSnaps||[]).filter(s=>s.pack_id===p.id);
          if(packSnaps.length>=2){
            const newest=Number(packSnaps[0].effective_ev_ratio);
            const older=Number(packSnaps[Math.min(10,packSnaps.length-1)].effective_ev_ratio);
            if(older>0)evTrend=newest-older;
          }
          
          const streak = getColdStreak(pullsByPack[p.id]||[], p.odds);
          return{...p,evRatio:r,signal:getValueSignal(r),realAvgPull:avgPull,totalPulls:totalP,evTrend,lastPullAt:lastPullMap[p.id]||null,streak};
        }));
      }
      if(pld)setPulls(pld);
      setLastPolled(new Date());
      setIsLive(true);
    }catch(e){console.error(e);}
  },[]);

  const triggerPoll=useCallback(async()=>{
    try{
      setPollInfo('polling...');
      const r=await fetch(POLL_FUNCTION_URL,{method:'POST'});
      const d=await r.json();
      setPollInfo(`${d.packs}p | ${d.chainPulls||0} pulls`);
      await fetchData();
    }catch{setPollInfo('error');}
  },[fetchData]);

  useEffect(()=>{
    fetchData();
    triggerPoll();
    const t=setInterval(triggerPoll,5000);
    return()=>clearInterval(t);
  },[fetchData,triggerPoll]);

  useEffect(()=>{
    if(!selectedId){setPackPulls([]);return;}
    const f=async()=>{
      const{data}=await supabase.from('pulls').select('*').eq('pack_id',selectedId).order('detected_at',{ascending:false}).limit(100);
      if(data)setPackPulls(data);
    };
    f();const iv=setInterval(f,5000);return()=>clearInterval(iv);
  },[selectedId]);

  const sectionPacks=useMemo(()=>{
    if(section==='ALL')return packs;
    return packs.filter(p=>section==='SPORTS'?isSports(p.category):!isSports(p.category));
  },[packs,section]);

  const categories=useMemo(()=>{const c={};sectionPacks.forEach(p=>{if(p.evRatio>0)c[p.category]=(c[p.category]||0)+1;});return c;},[sectionPacks]);
  const filtered=useMemo(()=>{
    let l=catFilter==='ALL'?sectionPacks:sectionPacks.filter(p=>p.category===catFilter);
    l=l.filter(p=>p.evRatio>0);
    const dir=sortDir==='desc'?-1:1;
    l.sort((a,b)=>{
      let va,vb;
      switch(sortBy){
        case'ev':va=a.evRatio;vb=b.evRatio;break;
        case'price':va=Number(a.price_usd);vb=Number(b.price_usd);break;
        case'trend':va=a.evTrend;vb=b.evTrend;break;
        case'pulls':va=a.totalPulls;vb=b.totalPulls;break;
        case'lastpull':va=a.lastPullAt?new Date(a.lastPullAt).getTime():0;vb=b.lastPullAt?new Date(b.lastPullAt).getTime():0;break;
        default:va=a.evRatio;vb=b.evRatio;
      }
      return(va-vb)*dir;
    });
    return l;
  },[sectionPacks,catFilter,sortBy,sortDir]);

  const filteredPulls=useMemo(()=>{
    if(section==='ALL')return pulls;
    return pulls.filter(p=>{const cat=packCatMap[p.pack_id];if(!cat)return section==='COLLECTIBLES';return section==='SPORTS'?isSports(cat):!isSports(cat);});
  },[pulls,section,packCatMap]);

  const sel=packs.find(p=>p.id===selectedId);
  const best=filtered[0];
  const handlePullClick=useCallback((pid)=>{if(pid)setSelectedId(pid);},[]);
  const handleSection=useCallback((s)=>{setSection(s);setCatFilter('ALL');},[]);
  const handleSort=useCallback((col)=>{if(sortBy===col)setSortDir(d=>d==='desc'?'asc':'desc');else{setSortBy(col);setSortDir('desc');}},[sortBy]);
  const sortArrow=(col)=>sortBy===col?(sortDir==='desc'?' ▾':' ▴'):'';

  const sportCount=packs.filter(p=>p.evRatio>0&&isSports(p.category)).length;
  const collectCount=packs.filter(p=>p.evRatio>0&&!isSports(p.category)).length;

  return(
    <div className="app">
      <header className="header">
        <div className="h-left">
          <span className="logo">SLAB TRACKER</span>
          <div className={`live-tag ${isLive?'on':''}`}><span className="dot"/><span>LIVE FEED</span></div>
          {lastPolled&&<span className="upd">Updated {timeAgo(lastPolled.toISOString())}</span>}
          {pollInfo&&<span className="poll-info">{pollInfo}</span>}
        </div>
        <div className="h-right"><a href="https://courtyard.io/vending-machine" target="_blank" rel="noreferrer" className="open-btn">OPEN PACK</a></div>
      </header>

      <div className="section-tabs">
        <button className={`stab ${section==='ALL'?'ac':''}`} onClick={()=>handleSection('ALL')}>ALL</button>
        <button className={`stab ${section==='SPORTS'?'ac':''}`} onClick={()=>handleSection('SPORTS')}>⚾ SPORTS {sportCount}</button>
        <button className={`stab ${section==='COLLECTIBLES'?'ac':''}`} onClick={()=>handleSection('COLLECTIBLES')}>🃏 COLLECTIBLES {collectCount}</button>
      </div>

      <div className="cat-bar">
        <button className={`cb ${catFilter==='ALL'?'ac':''}`} onClick={()=>setCatFilter('ALL')}>ALL {sectionPacks.filter(p=>p.evRatio>0).length}</button>
        {Object.entries(categories).sort().map(([c,n])=><button key={c} className={`cb ${catFilter===c?'ac':''}`} onClick={()=>setCatFilter(c)}>{c.toUpperCase().replace(/-/g,' ')} {n}</button>)}
      </div>

      {sel&&(
        <div className="detail">
          <button className="back" onClick={()=>setSelectedId(null)}>← Back to all packs</button>
          <div className="det-card" style={{borderColor:`${CATEGORY_COLORS[sel.category]||'#333'}44`}}>
            <div className="det-hdr">
              <div><div className="det-title">{sel.title}</div><div className="det-sigs"><span className="sig" style={{color:sel.signal.color,background:sel.signal.bg}}>{sel.signal.label}</span><span className="dim">{sel.out_of_stock?'OUT OF STOCK':'IN STOCK'}</span></div></div>
              <div className="det-ev"><div className="det-ev-n">{sel.evRatio.toFixed(3)}</div><div className="det-ev-l">EV RATIO</div></div>
            </div>
            <div className="sg">
              <div className="sc"><div className="sl">PACK PRICE</div><div className="sv">${Number(sel.price_usd).toFixed(0)}</div></div>
              <div className="sc"><div className="sl">CALIBRATED EV</div><div className="sv cy">${(sel.evRatio*Number(sel.price_usd)).toFixed(2)}</div></div>
              <div className="sc"><div className="sl">REAL AVG PULL</div><div className="sv">{sel.realAvgPull>0?`$${sel.realAvgPull.toFixed(2)}`:'Tracking...'}</div></div>
              <div className="sc"><div className="sl">TOTAL PULLS</div><div className="sv">{sel.totalPulls>0?sel.totalPulls.toLocaleString():'0'}</div><div className="stat-sub">{sel.inventory_count} in inventory</div></div>
            </div>
            {(()=>{
              const cs = getColdStreak(packPulls, sel.odds);
              if (!cs || cs.sinceRare < 3) return null;
              const hot = cs.sinceRare >= cs.expected * 1.5;
              const warm = cs.sinceRare >= cs.expected;
              return (
                <div className={`streak-banner ${hot ? 'streak-hot' : warm ? 'streak-warm' : 'streak-mild'}`}>
                  <span className="streak-icon">{hot ? '🔥' : warm ? '⚡' : '📊'}</span>
                  <span className="streak-text">
                    <strong>{cs.sinceRare} pulls</strong> since last rare+ {hot ? '— cold streak, EV building' : warm ? '— trending cold' : `(avg every ~${cs.expected})`}
                  </span>
                </div>
              );
            })()}
            <div className="det-split">
              <div className="det-left">
                <div className="det-pulls">
                  <div className="section-hdr"><div className="feed-t"><span>🔥</span> Just Pulled</div><div className="live-sm"><span className="dot-sm"/><span>live</span></div></div>
                  <div className="det-pull-list">{packPulls.length===0?<div className="empty-p">Monitoring for pulls...</div>:packPulls.map(p=>{
                    const evAtPull=p.ev_at_pull?Number(p.ev_at_pull):null;
                    return <PullItem key={p.id} pull={p} odds={sel.odds} evAtPull={evAtPull}/>;
                  })}</div>
                </div>
              </div>
              <div className="det-right">
                <OddsBreakdown odds={sel.odds} price={Number(sel.price_usd)} pulls={packPulls}/>
              </div>
            </div>
          </div>
        </div>
      )}

      {!sel&&(
        <div className="main">
          <div className="pack-list">
            <div className="list-hdr"><span>{section==='ALL'?'All Packs':section==='SPORTS'?'Sports Packs':'Collectible Packs'}</span></div>
            <div className="tbl-hdr"><span className="c1">#</span><span className="c2">PACK</span><span className="c3 sortable" onClick={()=>handleSort('ev')}>EV RATIO{sortArrow('ev')}</span><span className="c4 sortable" onClick={()=>handleSort('price')}>PRICE{sortArrow('price')}</span><span className="c5 sortable" onClick={()=>handleSort('trend')}>TREND{sortArrow('trend')}</span><span className="c6 sortable" onClick={()=>handleSort('pulls')}>PULLS{sortArrow('pulls')}</span><span className="c7">SIGNAL</span><span className="c9">STREAK</span><span className="c8 sortable" onClick={()=>handleSort('lastpull')}>LAST PULL{sortArrow('lastpull')}</span></div>
            <div className="rows">
              {filtered.map((p,i)=>(
                <div key={p.id} className="row" onClick={()=>setSelectedId(p.id)}>
                  <span className="c1">#{i+1}</span>
                  <div className="c2"><div className="rn">{p.title}</div>{p.out_of_stock&&<div className="rm"><span className="oos">OUT OF STOCK</span></div>}</div>
                  <div className="c3"><span className="ev-n">{p.evRatio.toFixed(3)}</span><Sparkline data={(snapshots[p.id]||[]).map(s=>Number(s.effective_ev_ratio))} width={40} height={16} color={p.evRatio>=1?'#334155':'#DC2626'}/></div>
                  <span className="c4">${Number(p.price_usd).toFixed(0)}</span>
                  <span className="c5" style={{fontWeight:600,color:p.evTrend>=0.10?'#16A34A':p.evTrend<=-0.10?'#DC2626':'#78716C'}}>{p.evTrend>=0.10?'▲':p.evTrend<=-0.10?'▼':'—'}{Math.abs(p.evTrend)>=0.01?` ${p.evTrend>0?'+':''}${p.evTrend.toFixed(2)}`:''}</span>
                  <span className="c6">{p.totalPulls>0?p.totalPulls.toLocaleString():'—'}</span>
                  <span className="c7"><span className="sig-sm" style={{color:p.signal.color,background:p.signal.bg}}>{p.signal.label}</span></span>
                  <span className="c9">{p.streak&&p.streak.sinceRare>=p.streak.expected?<span className="streak-cold">❄️ {p.streak.sinceRare}</span>:p.streak&&p.streak.sinceRare>=3?<span className="streak-num">{p.streak.sinceRare}</span>:'—'}</span>
                  <span className="c8">{p.lastPullAt?timeAgo(p.lastPullAt):'—'}</span>
                </div>
              ))}
              {!filtered.length&&<div className="empty">Loading packs...</div>}
            </div>
          </div>
          <div className="feeds">
            <div className="feed-hdr"><div className="feed-t"><span>🔥</span> Just Pulled</div><div className="live-sm"><span className="dot-sm"/><span>live</span></div></div>
            <div className="pull-list">{!filteredPulls.length?<div className="empty-p">Monitoring for pulls...</div>:filteredPulls.map(p=><PullItem key={p.id} pull={p} packTitle={packTitleMap[p.pack_id]} onPackClick={handlePullClick} odds={packOddsMap[p.pack_id]}/>)}</div>
          </div>
        </div>
      )}
      <footer className="foot">This tool is for educational and informational purposes only. Not financial advice.</footer>
    </div>
  );
}
