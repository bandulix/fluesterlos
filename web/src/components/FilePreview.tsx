import { useEffect, useState } from "react";

/** Preview of a chosen (not yet uploaded) image file. */
export function FilePreview({ file, className = "thumb" }: { file: File | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!url) return null;
  return <img src={url} alt="" className={className} />;
}
