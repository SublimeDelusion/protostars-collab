"use client";

import { useEffect, useState } from "react";

export default function InviteSharing({ url, copied, onCopy }: { url: string; copied: boolean; onCopy: () => void }) {
  const [show, setShow] = useState(false);
  const [qr, setQr] = useState("");
  const [qrError, setQrError] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => { setIos(/iPhone|iPad|iPod/.test(navigator.userAgent)); }, []);
  useEffect(() => {
    if (!show) return;
    let live = true;
    void import("qrcode").then(({ toDataURL }) => toDataURL(url, { width: 320, margin: 4 }))
      .then(value => { if (live) setQr(value); })
      .catch(() => { if (live) setQrError(true); });
    return () => { live = false; };
  }, [show, url]);
  const body = encodeURIComponent("Join me in FTC Workshop: " + url);
  return <>
    <label>Invite link<input readOnly value={url} onFocus={event => event.currentTarget.select()} /></label>
    <div className="team-actions invite-sharing">
      <button type="button" className="primary invite-copy" onClick={onCopy}>{copied ? "Copied" : "Copy link"}</button>
      <button type="button" className="quiet" aria-expanded={show} onClick={() => setShow(value => !value)}>{show ? "Hide QR code" : "Show QR code"}</button>
      <a className="quiet" href={`mailto:?subject=FTC%20Workshop%20invite&body=${body}`}>Email</a>
      <a className="quiet" href={`sms:${ios ? "&" : "?"}body=${body}`}>Text</a>
    </div>
    {show && (qr ? <img className="invite-qr" src={qr} alt="Scan this QR code to open the invite link" width={280} height={280} />
      : <p role="status">{qrError ? "Couldn’t create a QR code. You can still use the link." : "Creating QR code…"}</p>)}
  </>;
}
