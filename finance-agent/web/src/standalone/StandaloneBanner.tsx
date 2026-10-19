import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../components/ui';
import { startFresh, storageInfo } from './mockApi';

const WHERE = {
  cloud: 'Vos données sont enregistrées dans votre espace privé, visibles de vous seul.',
  browser: 'Vos données sont enregistrées dans ce navigateur.',
  memory: "Vos modifications ne seront pas conservées après fermeture de la page.",
};

/** Bandeau du mode autonome : signale les données d'exemple et où sont rangées les vôtres. */
export function StandaloneBanner() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['storage'], queryFn: storageInfo });
  const [confirming, setConfirming] = useState(false);
  if (!data) return null;

  const clear = async () => {
    await startFresh();
    setConfirming(false);
    await qc.invalidateQueries();
  };

  if (!data.demo) {
    return <p className="mb-4 text-xs text-muted">{WHERE[data.kind]}</p>;
  }
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[28px] bg-ink px-5 py-4 text-sm text-white">
      <p className="min-w-0 flex-1">
        <span className="font-medium">Données d'exemple.</span> Essayez librement : votre première modification les conserve comme point de départ.
        Vous pouvez aussi partir d'une app vide.
      </p>
      {confirming ? (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Annuler
          </Button>
          <Button className="bg-white !text-ink hover:bg-white/90" onClick={clear}>
            Tout effacer
          </Button>
        </div>
      ) : (
        <Button className="bg-white/15 hover:bg-white/25" onClick={() => setConfirming(true)}>
          Partir de zéro
        </Button>
      )}
    </div>
  );
}
