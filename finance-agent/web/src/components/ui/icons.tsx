// Icônes au trait, monochromes (héritent de la couleur du texte)
const paths = {
  home: 'M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z',
  bills: 'M7 3h10a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1zm2.5 5h5m-5 4h5',
  calendar: 'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm-1 4h16M8 3.5v4m8-4v4',
  budget: 'M6 20V12m6 8V5m6 15v-5',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zm4 4h4',
  settings: 'M4 7h10m4 0h2M4 17h4m4 0h8M16 5v4M10 15v4',
  income: 'M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14',
  clip: 'M16.5 7.5 9.4 14.6a2 2 0 0 0 2.8 2.8l7.1-7.1a4 4 0 0 0-5.7-5.7L6.5 11.7a6 6 0 0 0 8.5 8.5l5.5-5.5',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={paths[name]} />
    </svg>
  );
}
