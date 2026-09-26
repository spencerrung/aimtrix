/* Shared by the application and classic service worker. No account identity or content. */
(() => {
  const minute = (value) => Number.isInteger(value) && value >= 0 && value < 1440;
  const normalize = (value) => ({
    pauseUntil: Number.isFinite(value?.pauseUntil) && value.pauseUntil > 0 ? value.pauseUntil : 0,
    quietHours: {
      enabled: value?.quietHours?.enabled === true && minute(value.quietHours.startMinute) && minute(value.quietHours.endMinute),
      startMinute: minute(value?.quietHours?.startMinute) ? value.quietHours.startMinute : 1320,
      endMinute: minute(value?.quietHours?.endMinute) ? value.quietHours.endMinute : 480,
    },
  });
  const paused = (input, now = Date.now()) => {
    const policy = normalize(input);
    if (policy.pauseUntil > now) return true;
    const quiet = policy.quietHours;
    if (!quiet.enabled || quiet.startMinute === quiet.endMinute) return false;
    const date = new Date(now);
    const current = date.getHours() * 60 + date.getMinutes();
    return quiet.startMinute < quiet.endMinute
      ? current >= quiet.startMinute && current < quiet.endMinute
      : current >= quiet.startMinute || current < quiet.endMinute;
  };
  const claim = (seen, id, now = Date.now()) => {
    const recent = Array.isArray(seen) ? seen.filter((item) => typeof item?.id === 'string' && Number.isFinite(item.at) && item.at <= now && now - item.at < 86400000).slice(-128) : [];
    if (typeof id !== 'string' || !id || id.length > 1024) return { accepted: true, seen: recent };
    if (recent.some((item) => item.id === id)) return { accepted: false, seen: recent };
    return { accepted: true, seen: [...recent, { id, at: now }].slice(-128) };
  };
  // Only opaque owner generations, schedules and a bounded event-ID ledger.
  const transaction = (change) => new Promise((resolve, reject) => {
    let settled = false;
    let database;
    let tx;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (error && tx) { try { tx.abort(); } catch { /* Already finished. */ } }
      database?.close();
      if (error) reject(new Error(error));
      else resolve(result);
    };
    let request;
    try {
      if (!globalThis.indexedDB) throw new Error();
      request = globalThis.indexedDB.open('aimtrix-notification-policy-v1', 1);
    } catch { finish('Notification metadata storage unavailable'); return; }
    request.onupgradeneeded = () => {
      // A blocked request can resume after its caller has already moved on.
      // Abort its upgrade rather than allowing an abandoned owner to write.
      if (settled) {
        try { request.transaction?.abort(); } catch { /* Already finished. */ }
        request.result.close();
        return;
      }
      try { database = request.result; tx = request.transaction; database.createObjectStore('state'); }
      catch { finish('Notification metadata storage unavailable'); }
    };
    request.onerror = () => finish('Notification metadata storage unavailable');
    request.onblocked = () => finish('Notification metadata storage blocked');
    request.onsuccess = () => {
      database = request.result;
      if (settled) { database.close(); return; }
      try {
        tx = database.transaction('state', 'readwrite');
        let result;
        tx.oncomplete = () => finish(undefined, result);
        tx.onerror = tx.onabort = () => finish('Notification metadata update failed');
        const store = tx.objectStore('state');
        const read = store.get('current');
        read.onerror = () => finish('Notification metadata update failed');
        read.onsuccess = () => {
          if (settled) return;
          try { const next = change(read.result); result = next.result; store.put(next.state, 'current'); }
          catch { finish('Notification metadata update failed'); }
        };
      } catch { finish('Notification metadata update failed'); }
    };
  });
  globalThis.aimtrixNotificationPolicy = Object.freeze({ normalize, paused, claim, transaction });
})();
