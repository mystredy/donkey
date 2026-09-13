"use client";

import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ImageUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

// Generalizes the account profile picture's own crop dialog
// (settings/profile/AvatarDialog.tsx) to any output aspect ratio, so a
// studio's avatar (square) and banner (wide) share the same drag/zoom/canvas
// math instead of each carrying its own copy of it.
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const OUTPUT_TYPE = "image/webp";
const OUTPUT_QUALITY = 0.85;

type Picked = { url: string; width: number; height: number };

export function ImageCropDialog({
  open,
  onOpenChange,
  title,
  aspectClassName,
  outputWidth,
  outputHeight,
  hasCustomImage,
  onSave,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Tailwind aspect-ratio class for the crop frame, e.g. "aspect-square" or "aspect-[3/1]". */
  aspectClassName: string;
  outputWidth: number;
  outputHeight: number;
  hasCustomImage: boolean;
  onSave: (image: Blob) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  // The frame spans the dialog, so its size comes from layout rather than a
  // constant. offsetWidth/Height, not a rect: the dialog opens on a scale
  // animation, and a measured rect would come back mid-zoom.
  const [frame, setFrame] = useState({ width: 320, height: 320 });
  const frameRef = useCallback((el: HTMLDivElement | null) => {
    if (el) setFrame({ height: el.offsetHeight, width: el.offsetWidth });
  }, []);

  const close = () => {
    if (picked) URL.revokeObjectURL(picked.url);
    setPicked(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError(null);
    onOpenChange(false);
  };

  const pick = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (picked) URL.revokeObjectURL(picked.url);
      setPicked({ height: img.naturalHeight, url, width: img.naturalWidth });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("That file isn't an image we can read.");
    };
    img.src = url;
  };

  // Scale that makes the picture cover the frame at zoom 1.
  const cover = picked ? Math.max(frame.width / picked.width, frame.height / picked.height) : 1;
  const scale = cover * zoom;
  const drawn = picked
    ? { height: picked.height * scale, width: picked.width * scale }
    : { height: 0, width: 0 };
  // How far the picture may travel: overhang while it's larger than the
  // frame, the leftover room while it's smaller — either way it can't leave
  // the frame.
  const limit = {
    x: Math.abs(drawn.width - frame.width) / 2,
    y: Math.abs(drawn.height - frame.height) / 2,
  };
  const clamp = (value: number, max: number) => Math.min(max, Math.max(-max, value));
  const position = {
    left: (frame.width - drawn.width) / 2 + clamp(offset.x, limit.x),
    top: (frame.height - drawn.height) / 2 + clamp(offset.y, limit.y),
  };

  // Zooming out shrinks how far the picture can travel, so the stored offset
  // comes back inside the new limits with it — otherwise the next drag
  // starts from a position the frame is no longer showing.
  const applyZoom = (next: number) => {
    setZoom(next);
    if (!picked) return;
    const nextScale = cover * next;
    setOffset((cur) => ({
      x: clamp(cur.x, Math.abs(picked.width * nextScale - frame.width) / 2),
      y: clamp(cur.y, Math.abs(picked.height * nextScale - frame.height) / 2),
    }));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!picked) return;
    drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    setOffset({
      x: clamp(e.clientX - start.x, limit.x),
      y: clamp(e.clientY - start.y, limit.y),
    });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const save = async () => {
    if (!picked) return;
    setError(null);

    // The frame window, mapped back onto the source pixels it is showing.
    // Once zoomed out past cover the window runs off the picture; canvas
    // clips the overhang on both rectangles, so those edges come out
    // transparent.
    const source = {
      height: frame.height / scale,
      width: frame.width / scale,
      x: -position.left / scale,
      y: -position.top / scale,
    };
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext("2d");
    const image = new Image();
    image.src = picked.url;
    await image.decode();
    if (!ctx) {
      setError("Couldn't prepare that image — try again.");
      return;
    }
    ctx.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, outputWidth, outputHeight);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, OUTPUT_TYPE, OUTPUT_QUALITY);
    });
    if (!blob) {
      setError("Couldn't prepare that image — try again.");
      return;
    }

    setBusy(true);
    try {
      await onSave(blob);
      close();
    } catch {
      setError("Couldn't save that picture — try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await onRemove();
      close();
    } catch {
      setError("Couldn't remove that picture — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            ref={frameRef}
            className={cn("relative w-full overflow-hidden rounded-xl bg-muted", aspectClassName)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {picked ? (
              <img
                src={picked.url}
                alt=""
                draggable={false}
                className="absolute max-w-none cursor-grab select-none active:cursor-grabbing"
                style={{
                  height: drawn.height,
                  left: position.left,
                  top: position.top,
                  width: drawn.width,
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex size-full cursor-pointer flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
              >
                <ImageUp className="size-6" />
                Choose an image
              </button>
            )}
          </div>

          {picked && (
            <div className="flex w-full items-center gap-3">
              <span className="text-sm text-muted-foreground">Zoom</span>
              <Slider
                aria-label="Zoom"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onValueChange={(value) => applyZoom(Array.isArray(value) ? value[0] : value)}
              />
            </div>
          )}

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              {picked ? "Replace" : "Choose"}
            </Button>
            {hasCustomImage && !picked && (
              <Button variant="outline" disabled={busy} onClick={() => void remove()}>
                Remove
              </Button>
            )}
          </div>
          <Button disabled={!picked || busy} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
