import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { api, errorMessage } from '../api/client';
import type { MapImage, MapPoint, WorldMapData } from '../api/types';
import { refreshAll } from '../hooks/useApi';
import { useToast } from './Toast';
import { mapImageUrl } from './WorldMap';

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 25 * 1024 * 1024;

type RefId = 'a' | 'b';
interface Reference {
  /** Where on the image, in image pixels. */
  px: MapPoint | null;
  x: string;
  y: string;
}

const emptyRef: Reference = { px: null, x: '', y: '' };
const COLORS: Record<RefId, string> = { a: '#e53935', b: '#1e88e5' };

async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/**
 * Two points known on both the picture and the in-game map fix its scale and
 * position: a point's map coordinates are shown in game, or taken from a base
 * or player PalOps already knows.
 */
export function computeBounds(image: { width: number; height: number }, a: { px: MapPoint; at: MapPoint }, b: { px: MapPoint; at: MapPoint }) {
  const dx = b.px.x - a.px.x;
  const dy = b.px.y - a.px.y;
  if (Math.abs(dx) < image.width * 0.05 || Math.abs(dy) < image.height * 0.05) return null;
  const sx = (b.at.x - a.at.x) / dx;
  // Pixel y grows downward, map y grows north.
  const sy = (a.at.y - b.at.y) / dy;
  const left = a.at.x - a.px.x * sx;
  const top = a.at.y + a.px.y * sy;
  return { left, top, right: left + image.width * sx, bottom: top - image.height * sy };
}

export function MapImageDialog({ open, onClose, image, map }: { open: boolean; onClose: () => void; image: MapImage | null; map: WorldMapData | null }) {
  const notify = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'save' | 'remove' | null>(null);
  const [active, setActive] = useState<RefId>('a');
  const [refs, setRefs] = useState<Record<RefId, Reference>>({ a: emptyRef, b: emptyRef });
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setRefs({ a: emptyRef, b: emptyRef });
      setActive('a');
      setError(undefined);
    }
  }, [open, image?.updatedAt]);

  const known = [
    ...(map?.bases ?? []).map((b) => ({ id: `base-${b.id}`, label: `Base: ${b.guildName ?? b.guildId}`, at: b.at })),
    ...(map?.players ?? []).map((p) => ({ id: `player-${p.userId}`, label: `Player: ${p.name}`, at: p.at })),
  ];

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!TYPES.includes(file.type)) return notify('Choose a PNG, JPEG or WebP image', 'error');
    if (file.size > MAX_BYTES) return notify('The image must be 25 MB or smaller', 'error');
    setBusy('upload');
    try {
      const { width, height } = await imageSize(file);
      await api.put(`/world/map-image?width=${width}&height=${height}`, file);
      notify('Map image uploaded. Line it up next.', 'success');
      refreshAll();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    if (!image) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = { x: ((e.clientX - rect.left) / rect.width) * image.width, y: ((e.clientY - rect.top) / rect.height) * image.height };
    setRefs((r) => ({ ...r, [active]: { ...r[active], px } }));
    if (active === 'a' && !refs.b.px) setActive('b');
  };

  const update = (id: RefId, patch: Partial<Reference>) => setRefs((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const save = async () => {
    if (!image) return;
    const [a, b] = (['a', 'b'] as const).map((id) => {
      const r = refs[id];
      const at = { x: Number(r.x), y: Number(r.y) };
      return r.px && r.x.trim() !== '' && r.y.trim() !== '' && Number.isFinite(at.x) && Number.isFinite(at.y) ? { px: r.px, at } : null;
    });
    if (!a || !b) return setError('Click both points on the image and give each one its map coordinates.');
    const bounds = computeBounds(image, a, b);
    if (!bounds) return setError('Pick two points further apart, both across and up or down the image.');
    setBusy('save');
    setError(undefined);
    try {
      await api.patch('/world/map-image', bounds);
      notify('Map lined up', 'success');
      refreshAll();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      await api.delete('/world/map-image');
      notify('Map image removed', 'success');
      refreshAll();
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Map image</DialogTitle>
      <DialogContent dividers>
        <input ref={input} type="file" accept={TYPES.join(',')} hidden onChange={(e) => void upload(e.target.files?.[0])} />
        {!image ? (
          <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Typography>
              PalOps doesn’t include the game’s map art. Upload a picture of the Palworld map (a screenshot of the in-game map works), then line it up
              with two points. Only staff who can see the live map can see it.
            </Typography>
            <Button variant="contained" startIcon={<UploadFileOutlinedIcon />} loading={busy === 'upload'} loadingPosition="start" onClick={() => input.current?.click()}>
              Upload image
            </Button>
            <Typography variant="body2" color="text.secondary">
              PNG, JPEG or WebP, up to 25 MB.
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Typography>
              Click a spot on the image, then enter its in-game map coordinates. Do it for two spots far apart, such as two bases in opposite corners.
              You can read coordinates on the in-game map, or pick a base or player PalOps already knows.
            </Typography>
            {!image.aligned && <Alert severity="info">Until you line it up, the image is placed by a guess and markers may not match.</Alert>}
            <ToggleButtonGroup exclusive value={active} onChange={(_, v: RefId | null) => v && setActive(v)} size="small">
              <ToggleButton value="a">Placing point 1</ToggleButton>
              <ToggleButton value="b">Placing point 2</ToggleButton>
            </ToggleButtonGroup>
            <Box onClick={pick} sx={{ position: 'relative', cursor: 'crosshair', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', lineHeight: 0 }}>
              <Box component="img" src={mapImageUrl(image)} alt="Uploaded map" draggable={false} sx={{ width: '100%', height: 'auto', display: 'block' }} />
              {(['a', 'b'] as const).map((id) =>
                refs[id].px ? (
                  <Box
                    key={id}
                    sx={{
                      position: 'absolute',
                      left: `${(refs[id].px!.x / image.width) * 100}%`,
                      top: `${(refs[id].px!.y / image.height) * 100}%`,
                      width: 22,
                      height: 22,
                      ml: '-11px',
                      mt: '-11px',
                      borderRadius: '50%',
                      border: '3px solid white',
                      bgcolor: COLORS[id],
                      color: 'white',
                      fontSize: 12,
                      fontWeight: 700,
                      display: 'grid',
                      placeItems: 'center',
                      lineHeight: 1,
                      boxShadow: 2,
                      pointerEvents: 'none',
                    }}
                  >
                    {id === 'a' ? 1 : 2}
                  </Box>
                ) : null,
              )}
            </Box>
            {(['a', 'b'] as const).map((id) => (
              <Stack key={id} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
                <Typography sx={{ fontWeight: 600, minWidth: 64, color: COLORS[id] }}>Point {id === 'a' ? 1 : 2}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 110 }}>
                  {refs[id].px ? 'Placed on image' : 'Not placed yet'}
                </Typography>
                <TextField label="Map X" type="number" value={refs[id].x} onChange={(e) => update(id, { x: e.target.value })} sx={{ maxWidth: { sm: 120 } }} />
                <TextField label="Map Y" type="number" value={refs[id].y} onChange={(e) => update(id, { y: e.target.value })} sx={{ maxWidth: { sm: 120 } }} />
                {known.length > 0 && (
                  <TextField
                    select
                    label="Or use"
                    value=""
                    onChange={(e) => {
                      const k = known.find((k) => k.id === e.target.value);
                      if (k) update(id, { x: String(Math.round(k.at.x)), y: String(Math.round(k.at.y)) });
                    }}
                    sx={{ minWidth: 180 }}
                  >
                    {known.map((k) => (
                      <MenuItem key={k.id} value={k.id}>
                        {k.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              </Stack>
            ))}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        {image && (
          <>
            <Button color="error" onClick={remove} loading={busy === 'remove'}>
              Remove
            </Button>
            <Button onClick={() => input.current?.click()} loading={busy === 'upload'}>
              Replace image
            </Button>
            <Box sx={{ flex: 1 }} />
          </>
        )}
        <Button onClick={onClose}>Close</Button>
        {image && (
          <Button variant="contained" onClick={save} loading={busy === 'save'}>
            Save alignment
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
