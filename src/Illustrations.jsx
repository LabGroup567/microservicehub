/* Animated illustrations for the home page cards. Pure SVG + CSS (see the `il-` rules in
   App.css), so they stay sharp on every screen and add no image downloads. */

const Scene = ({ children, label, tone = 'mint' }) => (
  <svg className={`il il-${tone}`} viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" role="img" aria-label={label}>
    <defs>
      <linearGradient id={`il-bg-${tone}`} x1="0" y1="0" x2="1" y2="1">
        {tone === 'mint' && (
          <>
            <stop offset="0" stopColor="#d9f3e8" />
            <stop offset="1" stopColor="#f2fbf7" />
          </>
        )}
        {tone === 'gold' && (
          <>
            <stop offset="0" stopColor="#fff1cf" />
            <stop offset="1" stopColor="#fffaf0" />
          </>
        )}
        {tone === 'teal' && (
          <>
            <stop offset="0" stopColor="#cdf3ee" />
            <stop offset="1" stopColor="#effcfa" />
          </>
        )}
      </linearGradient>
    </defs>
    <rect width="400" height="240" fill={`url(#il-bg-${tone})`} />
    <circle className="il-blob il-blob-a" cx="70" cy="50" r="46" fill="#ffffff" opacity="0.55" />
    <circle className="il-blob il-blob-b" cx="340" cy="200" r="58" fill="#ffffff" opacity="0.5" />
    {children}
  </svg>
);

const Sparkle = ({ x, y, delay = 0 }) => (
  <g transform={`translate(${x} ${y})`}>
    <g className="il-twinkle" style={{ animationDelay: `${delay}s` }}>
      <path d="M0 -9 L2.4 -2.4 L9 0 L2.4 2.4 L0 9 L-2.4 2.4 L-9 0 L-2.4 -2.4 Z" fill="#f2b84b" />
    </g>
  </g>
);

/** A clipboard whose tasks tick off while a pencil writes. */
export function PostWorkArt() {
  return (
    <Scene label="A clipboard with a task list being filled in" tone="mint">
      <g className="il-float">
        <rect x="128" y="34" width="144" height="178" rx="16" fill="#0a3a2d" opacity="0.12" transform="translate(6 8)" />
        <rect x="128" y="34" width="144" height="178" rx="16" fill="#ffffff" stroke="#c7e4d6" strokeWidth="2" />
        <rect x="166" y="24" width="68" height="24" rx="10" fill="#0b7a5b" />
        <circle cx="200" cy="36" r="5" fill="#d9f3e8" />

        {[0, 1, 2].map((row) => (
          <g key={row} transform={`translate(0 ${row * 42})`}>
            <circle cx="152" cy="82" r="11" fill="#e5f6ee" />
            <path className="il-tick" style={{ animationDelay: `${row * 0.9}s` }} d="M146.5 82 l4 4 l8 -9" fill="none" stroke="#0b7a5b" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="174" y="76" width={86 - row * 12} height="7" rx="3.5" fill="#d3e7de" />
            <rect x="174" y="89" width={54 - row * 6} height="6" rx="3" fill="#e6f1ec" />
          </g>
        ))}
      </g>

      <g className="il-write">
        <path d="M0 0 L26 -26 L36 -16 L10 10 L-6 14 Z" fill="#f2b84b" />
        <path d="M26 -26 L32 -32 L42 -22 L36 -16 Z" fill="#0a3a2d" />
        <path d="M-6 14 L10 10 L0 0 Z" fill="#fff" stroke="#0a3a2d" strokeWidth="1.5" />
      </g>

      <g transform="translate(300 62)">
        <g className="il-pulse">
          <circle r="22" fill="#0b7a5b" />
          <path d="M-9 0 H9 M0 -9 V9" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
        </g>
      </g>
      <Sparkle x={78} y={170} delay={0.2} />
      <Sparkle x={330} y={150} delay={1} />
    </Scene>
  );
}

/** Applicant cards drift past; the best one gets a check badge. */
export function ReviewArt() {
  const people = [
    { y: 34, name: 'a', color: '#7fc7a4', best: false },
    { y: 92, name: 'b', color: '#14b8a6', best: true },
    { y: 150, name: 'c', color: '#f2b84b', best: false },
  ];

  return (
    <Scene label="Applicant cards, one marked as chosen" tone="teal">
      {people.map((person, index) => (
        <g key={person.name} transform={`translate(0 ${person.y})`}>
         <g className="il-slide" style={{ animationDelay: `${index * 0.5}s` }}>
          <rect x="84" y="0" width="232" height="46" rx="14" fill="#fff" stroke={person.best ? '#0b7a5b' : '#d3e7de'} strokeWidth={person.best ? 2.5 : 1.5} />
          <circle cx="112" cy="23" r="14" fill={person.color} />
          <circle cx="112" cy="19" r="5" fill="#fff" opacity="0.9" />
          <path d="M103 32 a9 7 0 0 1 18 0" fill="#fff" opacity="0.9" />
          <rect x="136" y="13" width="84" height="8" rx="4" fill="#cfe3da" />
          <g transform="translate(138 30)">
            {[0, 1, 2, 3, 4].map((star) => (
              <circle key={star} className="il-twinkle" style={{ animationDelay: `${star * 0.15}s` }} cx={star * 13} cy="0" r="4" fill={person.best || star < 3 ? '#f2b84b' : '#e3ebe7'} />
            ))}
          </g>
          {person.best && (
            <g transform="translate(296 23)">
              <g className="il-pop">
                <circle r="15" fill="#0b7a5b" />
                <path d="M-6 0 l4 4 l8 -9" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            </g>
          )}
         </g>
        </g>
      ))}
      <Sparkle x={52} y={56} delay={0.4} />
      <Sparkle x={352} y={186} delay={1.2} />
    </Scene>
  );
}

/** A map with a pin that drops in and sends out ripples. */
export function FindProvidersArt() {
  return (
    <Scene label="A map with a location pin and nearby providers" tone="mint">
      <g opacity="0.9">
        <rect x="70" y="30" width="260" height="180" rx="18" fill="#fff" stroke="#c7e4d6" strokeWidth="2" />
        <path d="M70 100 H330 M70 160 H330 M150 30 V210 M250 30 V210" stroke="#e1efe8" strokeWidth="3" />
        <path d="M70 180 C130 130 190 190 240 120 S310 80 330 70" fill="none" stroke="#f2b84b" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 12" className="il-dash" />
      </g>

      {[
        { x: 112, y: 70, c: '#14b8a6', d: 0 },
        { x: 288, y: 150, c: '#f2b84b', d: 0.6 },
        { x: 120, y: 172, c: '#7fc7a4', d: 1.2 },
      ].map((dot, i) => (
        <g key={i} className="il-float" style={{ animationDelay: `${dot.d}s` }}>
          <circle cx={dot.x} cy={dot.y} r="13" fill={dot.c} />
          <circle cx={dot.x} cy={dot.y - 3} r="4.5" fill="#fff" />
          <path d={`M${dot.x - 8} ${dot.y + 8} a8 6 0 0 1 16 0`} fill="#fff" />
        </g>
      ))}

      <g transform="translate(200 128)">
        <circle className="il-ripple" r="14" fill="none" stroke="#0b7a5b" strokeWidth="3" />
        <circle className="il-ripple il-ripple-2" r="14" fill="none" stroke="#0b7a5b" strokeWidth="3" />
        <g className="il-drop">
          <path d="M0 0 C-22 -26 -22 -58 0 -58 C22 -58 22 -26 0 0 Z" fill="#0b7a5b" transform="translate(0 -4)" />
          <circle cx="0" cy="-34" r="9" fill="#fff" />
        </g>
      </g>
      <Sparkle x={52} y={44} delay={0.3} />
    </Scene>
  );
}

/** A magnifying glass sweeping over job listings. */
export function FindWorkArt() {
  return (
    <Scene label="A magnifying glass searching through job listings" tone="gold">
      {[0, 1, 2].map((row) => (
        <g key={row} transform={`translate(0 ${row * 56})`}>
          <rect x="70" y="30" width="260" height="42" rx="12" fill="#fff" stroke={row === 1 ? '#f2b84b' : '#ecdcb5'} strokeWidth={row === 1 ? 2.5 : 1.5} />
          <rect x="86" y="42" width="110" height="8" rx="4" fill="#efe3c3" />
          <rect x="86" y="55" width="70" height="6" rx="3" fill="#f6eed7" />
          <rect x="256" y="42" width="58" height="20" rx="10" fill={row === 1 ? '#0b7a5b' : '#e8f1ed'} />
          <rect x="266" y="49" width="38" height="6" rx="3" fill={row === 1 ? '#fff' : '#c9ddd3'} />
        </g>
      ))}

      <g className="il-search">
        <circle cx="0" cy="0" r="28" fill="#ffffff" fillOpacity="0.55" stroke="#0a3a2d" strokeWidth="7" />
        <path d="M20 20 L44 44" stroke="#0a3a2d" strokeWidth="9" strokeLinecap="round" />
        <path d="M-14 -10 a18 18 0 0 1 14 -10" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      </g>
      <Sparkle x={344} y={36} delay={0.5} />
    </Scene>
  );
}

/** Interlocking gears and a wrench: the services you offer. */
export function ServicesArt() {
  const teeth = (count, radius, size) =>
    Array.from({ length: count }, (_, i) => (
      <rect key={i} x={-size / 2} y={-radius - size} width={size} height={size * 1.4} rx="2" transform={`rotate(${(360 / count) * i})`} />
    ));

  return (
    <Scene label="Gears and a wrench" tone="mint">
      <g transform="translate(160 118)">
        <g className="il-spin" fill="#0b7a5b">
          <circle r="52" />
          {teeth(10, 52, 18)}
          <circle r="22" fill="#e5f6ee" />
          <circle r="9" fill="#0b7a5b" />
        </g>
      </g>

      <g transform="translate(246 82)">
        <g className="il-spin il-spin-rev" fill="#f2b84b">
          <circle r="34" />
          {teeth(8, 34, 14)}
          <circle r="14" fill="#fff5dc" />
          <circle r="6" fill="#f2b84b" />
        </g>
      </g>

      <g transform="translate(292 168)">
        <g className="il-wrench">
          <rect x="-5" y="-6" width="10" height="64" rx="5" fill="#0a3a2d" />
          <path d="M-17 -32 a17 17 0 1 1 34 0 a17 17 0 0 1 -10 15 h-14 a17 17 0 0 1 -10 -15 Z" fill="#0a3a2d" />
          <rect x="-7" y="-52" width="14" height="22" fill="#d9f3e8" />
        </g>
      </g>
      <Sparkle x={62} y={52} delay={0.1} />
      <Sparkle x={350} y={42} delay={0.9} />
    </Scene>
  );
}

/** A paper plane carrying an application, with a check when it lands. */
export function ApplicationsArt() {
  return (
    <Scene label="A paper plane delivering an application" tone="teal">
      <path id="il-route" d="M56 190 C110 170 130 90 200 110 S300 60 340 56" fill="none" stroke="#14b8a6" strokeWidth="3" strokeDasharray="3 10" strokeLinecap="round" opacity="0.8" className="il-dash" />

      <g transform="translate(300 120)">
        <rect x="-44" y="-30" width="88" height="62" rx="12" fill="#fff" stroke="#bfe6df" strokeWidth="2" />
        <path d="M-40 -26 L0 4 L40 -26" fill="none" stroke="#14b8a6" strokeWidth="3" strokeLinejoin="round" />
        <g transform="translate(34 -30)">
          <g className="il-pop il-pop-late">
            <circle r="15" fill="#0b7a5b" />
            <path d="M-6 0 l4 4 l8 -9" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
      </g>

      <g className="il-plane">
        <path d="M0 0 L46 -18 L30 24 L20 8 Z" fill="#0b7a5b" />
        <path d="M0 0 L46 -18 L20 8 Z" fill="#14b8a6" />
        <path d="M20 8 L30 24 L26 6 Z" fill="#0a3a2d" />
      </g>

      <g transform="translate(78 62)">
        <g className="il-float">
          <rect width="62" height="76" rx="9" fill="#fff" stroke="#bfe6df" strokeWidth="2" />
          <rect x="12" y="14" width="38" height="6" rx="3" fill="#cdeee8" />
          <rect x="12" y="28" width="38" height="6" rx="3" fill="#dff4f0" />
          <rect x="12" y="42" width="24" height="6" rx="3" fill="#dff4f0" />
          <circle cx="44" cy="60" r="7" fill="#f2b84b" />
        </g>
      </g>
      <Sparkle x={168} y={42} delay={0.6} />
    </Scene>
  );
}

/** A grid of colourful service tiles with a compass: "explore every kind of service". */
export function ExploreArt() {
  const tiles = [
    { x: 92, y: 40, c: '#ffd9d4', i: 'circle', d: 0 },
    { x: 160, y: 40, c: '#d8e6ff', i: 'square', d: 0.5 },
    { x: 228, y: 40, c: '#d2f2e7', i: 'triangle', d: 1 },
    { x: 92, y: 108, c: '#e6dcff', i: 'diamond', d: 1.5 },
    { x: 160, y: 108, c: '#ffe3cc', i: 'circle', d: 2 },
    { x: 228, y: 108, c: '#fff0c4', i: 'square', d: 2.5 },
  ];

  const mark = (kind, cx, cy) => {
    if (kind === 'circle') return <circle cx={cx} cy={cy} r="11" fill="#fff" />;
    if (kind === 'square') return <rect x={cx - 10} y={cy - 10} width="20" height="20" rx="5" fill="#fff" />;
    if (kind === 'triangle') return <path d={`M${cx} ${cy - 12} L${cx + 12} ${cy + 9} L${cx - 12} ${cy + 9} Z`} fill="#fff" strokeLinejoin="round" />;
    return <rect x={cx - 9} y={cy - 9} width="18" height="18" rx="4" fill="#fff" transform={`rotate(45 ${cx} ${cy})`} />;
  };

  return (
    <Scene label="A grid of service tiles with a compass" tone="teal">
      <g className="il-float">
        {tiles.map((tile) => (
          <g key={`${tile.x}-${tile.y}`} className="il-pulse" style={{ animationDelay: `${tile.d}s`, transformOrigin: `${tile.x + 28}px ${tile.y + 28}px` }}>
            <rect x={tile.x} y={tile.y} width="56" height="56" rx="16" fill="#fff" stroke="#cfe6df" strokeWidth="2" />
            <rect x={tile.x + 8} y={tile.y + 8} width="40" height="40" rx="12" fill={tile.c} />
            {mark(tile.i, tile.x + 28, tile.y + 28)}
          </g>
        ))}
        <rect x="92" y="176" width="192" height="12" rx="6" fill="#fff" opacity="0.8" />
        <rect x="92" y="176" width="110" height="12" rx="6" fill="#14b8a6" opacity="0.55" />
      </g>

      <g transform="translate(318 74)">
        <circle r="30" fill="#fff" stroke="#0b7a5b" strokeWidth="3" />
        <circle r="24" fill="#e8f7f2" />
        <g className="il-wobble">
          <path d="M0 -17 L6 0 L0 17 L-6 0 Z" fill="#0b7a5b" transform="rotate(35)" />
          <path d="M0 -17 L6 0 L-6 0 Z" fill="#f2b84b" transform="rotate(35)" />
        </g>
        <circle r="3" fill="#fff" />
      </g>
      <Sparkle x={58} y={50} delay={0.2} />
      <Sparkle x={352} y={190} delay={0.9} />
    </Scene>
  );
}

/** A provider's profile card with a verified badge, stars, a Book button and a calendar. */
export function HireArt() {
  return (
    <Scene label="A provider profile with a verified badge, stars and a booking button" tone="gold">
      <g className="il-float">
        <rect x="118" y="30" width="164" height="178" rx="18" fill="#7a5a10" opacity="0.1" transform="translate(6 8)" />
        <rect x="118" y="30" width="164" height="178" rx="18" fill="#fff" stroke="#ecdcb5" strokeWidth="2" />

        <circle cx="200" cy="78" r="26" fill="#0b7a5b" />
        <circle cx="200" cy="70" r="8.5" fill="#fff" />
        <path d="M184 94 a16 12 0 0 1 32 0" fill="#fff" />
        <g className="il-pulse" style={{ transformOrigin: '224px 96px' }}>
          <circle cx="224" cy="96" r="10" fill="#14b8a6" stroke="#fff" strokeWidth="3" />
          <path d="M219.5 96 l3.2 3.2 l6 -6.6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        <rect x="162" y="116" width="76" height="9" rx="4.5" fill="#e6d9b3" />
        <rect x="176" y="131" width="48" height="6" rx="3" fill="#f1e8cf" />

        <g transform="translate(160 146)">
          {[0, 1, 2, 3, 4].map((n) => (
            <path key={n} transform={`translate(${n * 17} 0)`} d="M8 0 L10 5.6 L16 5.8 L11.2 9.4 L12.9 15.2 L8 11.8 L3.1 15.2 L4.8 9.4 L0 5.8 L6 5.6 Z" fill={n < 4 ? '#f2b84b' : '#ecdcb5'} />
          ))}
        </g>

        <rect x="146" y="170" width="108" height="26" rx="13" fill="#0b7a5b" />
        <rect x="178" y="180" width="44" height="7" rx="3.5" fill="#d9f3e8" />
      </g>

      <g transform="translate(292 54)">
       <g className="il-float" style={{ animationDelay: '0.8s' }}>
        <rect width="54" height="58" rx="12" fill="#fff" stroke="#ecdcb5" strokeWidth="2" />
        <path d="M0 14 a12 12 0 0 1 12 -12 h30 a12 12 0 0 1 12 12 v4 h-54 z" fill="#f2b84b" />
        {[0, 1, 2].map((r) =>
          [0, 1, 2].map((c) => (
            <circle key={`${r}${c}`} cx={13 + c * 14} cy={30 + r * 9} r="3" fill={r === 1 && c === 1 ? '#0b7a5b' : '#e9dfc3'} />
          ))
        )}
       </g>
      </g>
      <Sparkle x={70} y={52} delay={0.4} />
      <Sparkle x={344} y={176} delay={1.1} />
    </Scene>
  );
}
