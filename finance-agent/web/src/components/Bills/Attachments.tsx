import { useEffect, useRef, useState, type DragEvent } from 'react';
import { MAX_ATTACHMENT, readAttachment } from '../../standalone/vault';
import type { Attachment } from '../../types';
import { Button, Modal } from '../ui';
import { Icon } from '../ui/icons';

const ACCEPT = 'application/pdf,image/*';
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`);

/** Zone où glisser (ou choisir) le fichier d'une facture. */
export function AttachmentDrop({
  current,
  file,
  onFile,
  onRemove,
}: {
  current: Attachment | null;
  file: File | null;
  onFile: (f: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const take = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_ATTACHMENT) return setError(`Fichier trop lourd : ${size(MAX_ATTACHMENT)} au plus.`);
    setError('');
    onFile(f);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files[0]);
  };
  const shown = file ? { name: file.name, size: file.size } : current;

  return (
    <div>
      <span className="mb-1 block text-xs text-muted">Fichier de la facture (facultatif)</span>
      {shown ? (
        <div className="flex items-center gap-3 rounded-2xl bg-field px-3.5 py-2.5 text-sm">
          <Icon name="clip" className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{shown.name}</span>
          <span className="whitespace-nowrap text-xs text-muted">{size(shown.size)}</span>
          <button type="button" onClick={() => input.current?.click()} className="text-xs text-muted hover:text-ink">
            Remplacer
          </button>
          <button type="button" onClick={onRemove} className="text-xs text-red-400">
            Retirer
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={`flex w-full flex-col items-center gap-1 rounded-2xl border border-dashed px-4 py-5 text-sm transition ${over ? 'border-ink bg-white/5' : 'border-white/15 hover:border-white/30'}`}
        >
          <Icon name="clip" className="h-5 w-5 text-muted" />
          <span>Glissez le PDF ou la photo de la facture ici</span>
          <span className="text-xs text-muted">ou cliquez pour choisir un fichier · {size(MAX_ATTACHMENT)} au plus</span>
        </button>
      )}
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => take(e.target.files?.[0])} />
      {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
    </div>
  );
}

/** Aperçu d'une pièce jointe déchiffrée, avec enregistrement sur l'appareil. */
export function AttachmentViewer({ attachment, onClose }: { attachment: Attachment | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    if (!attachment) return;
    let objectUrl: string | null = null;
    setUrl(null);
    setError('');
    setSaveMsg('');
    readAttachment(attachment)
      .then((b) => {
        objectUrl = URL.createObjectURL(b);
        setBlob(b);
        setUrl(objectUrl);
      })
      .catch((e: Error) => setError(e.message || 'Fichier illisible'));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment]);

  const save = async () => {
    if (!blob || !attachment) return;
    const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
    const downloads = (await claude?.use('downloads').catch(() => null)) as { save(f: { filename: string; data: Blob }): Promise<unknown> } | null;
    if (downloads) {
      try {
        await downloads.save({ filename: attachment.name, data: blob });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code !== 'declined') setSaveMsg(code === 'rejected_extension' ? 'Ce type de fichier ne peut pas être enregistré ici.' : 'Enregistrement indisponible.');
      }
      return;
    }
    // Hors artefact : simple lien de téléchargement
    const a = document.createElement('a');
    a.href = url!;
    a.download = attachment.name;
    a.click();
  };

  const isPdf = attachment?.type === 'application/pdf';
  const isImage = attachment?.type.startsWith('image/');
  return (
    <Modal open={attachment !== null} onClose={onClose} title={attachment?.name ?? 'Fichier'}>
      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : !url ? (
        <p className="py-8 text-center text-sm text-muted">Déchiffrement…</p>
      ) : isImage ? (
        <img src={url} alt={attachment!.name} className="max-h-[60vh] w-full rounded-2xl object-contain" />
      ) : isPdf ? (
        <iframe src={url} title={attachment!.name} className="h-[60vh] w-full rounded-2xl bg-white" />
      ) : (
        <p className="text-sm text-muted">Aperçu indisponible pour ce type de fichier.</p>
      )}
      {saveMsg && <p className="mt-3 text-xs text-red-400">{saveMsg}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" className="bg-field" onClick={onClose}>
          Fermer
        </Button>
        <Button onClick={save} disabled={!blob}>
          Enregistrer sur l’appareil
        </Button>
      </div>
    </Modal>
  );
}
