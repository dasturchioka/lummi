/** The wordmark and the "L." monogram from the logo pack. The trailing dot is part of the mark. */
const WORDMARK =
  'M120 0V-700H211V-55H572V0ZM982.0 -700V-270Q982.0 -229 990.0 -179.5Q998.0 -130 1028.0 -87.5Q1058.0 -45 1117.0 -16.5Q1176.0 12 1278.0 12Q1342.0 12 1391.5 -8.0Q1441.0 -28 1474.5 -63.0Q1508.0 -98 1525.0 -144.5Q1542.0 -191 1542.0 -244V-700H1498.0V-277Q1498.0 -255 1497.0 -232.5Q1496.0 -210 1491.0 -187.5Q1486.0 -165 1475.5 -143.0Q1465.0 -121 1445.0 -99Q1409.0 -60 1364.0 -46.0Q1319.0 -32 1270.0 -32Q1228.0 -32 1195.5 -45.0Q1163.0 -58 1134.0 -84Q1111.0 -104 1099.0 -124.0Q1087.0 -144 1081.0 -163.5Q1075.0 -183 1074.0 -203.0Q1073.0 -223 1073.0 -243V-700ZM2110.0 -700H2042.0V0H2086.0V-571H2090.0L2399.0 12H2417.0L2733.0 -567H2737.0V0H2828.0V-700H2759.0L2435.0 -99H2431.0ZM3436.0 -700H3368.0V0H3412.0V-571H3416.0L3725.0 12H3743.0L4059.0 -567H4063.0V0H4154.0V-700H4085.0L3761.0 -99H3757.0ZM4734.0 -700V0H4825.0V-700ZM5365.0 -43Q5365.0 -65 5381.0 -81.0Q5397.0 -97 5419.0 -97Q5441.0 -97 5457.0 -81.0Q5473.0 -65 5473.0 -43Q5473.0 -21 5457.0 -5.0Q5441.0 11 5419.0 11Q5397.0 11 5381.0 -5.0Q5365.0 -21 5365.0 -43Z';
const MONOGRAM =
  'M120 0V-700H211V-55H572V0ZM742.0 -43Q742.0 -65 758.0 -81.0Q774.0 -97 796.0 -97Q818.0 -97 834.0 -81.0Q850.0 -65 850.0 -43Q850.0 -21 834.0 -5.0Q818.0 11 796.0 11Q774.0 11 758.0 -5.0Q742.0 -21 742.0 -43Z';

/** `height` in px; the wordmark is 5.4x wider, so 16 px tall is about 86 px (brand minimum is 80). */
export function Logo({ height = 16, className }: { height?: number; className?: string }) {
  return (
    <svg
      role="img"
      aria-label="LUMMI."
      viewBox="-50.9 -870.9 5694.8 1053.8"
      height={height}
      className={className}
      style={{ width: 'auto' }}
    >
      <path fill="currentColor" d={WORDMARK} />
    </svg>
  );
}

/** Monogram "L."; brand minimum on screen is 32 px. */
export function Monogram({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      role="img"
      aria-label="L."
      viewBox="-50.6 -870.6 1071.3 1052.3"
      width={size}
      height={size}
      className={className}
    >
      <path fill="currentColor" d={MONOGRAM} />
    </svg>
  );
}
