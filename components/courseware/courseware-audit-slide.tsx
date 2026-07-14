'use client';

import { useEffect, useState } from 'react';
import { SlideCanvas } from '@openmaic/renderer';
import type { Slide } from '@openmaic/dsl';

export function CoursewareAuditSlide({ slide }: { readonly slide: Slide }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setReady(true);
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <style>{'nextjs-portal { display: none !important; }'}</style>
      <main
        data-courseware-audit-slide=""
        data-courseware-audit-ready={ready ? 'true' : 'false'}
        style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#ffffff' }}
      >
        <SlideCanvas slide={slide} chrome={false} />
      </main>
    </>
  );
}
