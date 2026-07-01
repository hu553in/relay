import { Fragment, useMemo } from 'react';

import { WindowFrame } from '@/app/window-frame';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { languageTag } from '@/shared/languages';
import type { RelayState } from '@/shared/types';

const emptyCaptionText = '[empty]';

interface OverlayRow {
  id: string;
  original: string;
  originalLanguage: string;
  translation: string;
  translationLanguage: string;
}

export function Overlay({ state }: { state: RelayState }) {
  const rows = useMemo<OverlayRow[]>(() => {
    const captionRows = state.captions.slice(-state.settings.overlayRows);
    const placeholderCount = Math.max(0, state.settings.overlayRows - captionRows.length);

    const placeholderRows: OverlayRow[] = Array.from({ length: placeholderCount }, (_, index) => ({
      id: `placeholder-${String(index)}`,
      originalLanguage: state.settings.originalLanguage,
      translationLanguage: state.settings.translationLanguage,
      original: emptyCaptionText,
      translation: emptyCaptionText,
    }));

    return [...placeholderRows, ...captionRows];
  }, [
    state.captions,
    state.settings.originalLanguage,
    state.settings.overlayRows,
    state.settings.translationLanguage,
  ]);

  return (
    <WindowFrame
      className='grid w-screen place-items-center p-3'
      style={{ opacity: state.settings.overlayOpacity }}
    >
      <Card className='w-full'>
        <CardContent className='flex flex-col gap-2'>
          {rows.map((caption, index) => (
            <Fragment key={caption.id}>
              <div className={cn('flex flex-col gap-1.5', index < rows.length - 1 && 'opacity-60')}>
                <CaptionLine
                  language={languageTag(caption.originalLanguage)}
                  text={caption.original || emptyCaptionText}
                />
                <CaptionLine
                  language={languageTag(caption.translationLanguage)}
                  text={caption.translation || emptyCaptionText}
                />
              </div>
              {index < rows.length - 1 ? <Separator /> : null}
            </Fragment>
          ))}
        </CardContent>
      </Card>
    </WindowFrame>
  );
}

function CaptionLine({ language, text }: { language: string; text: string }) {
  return (
    <div className='grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-4 max-[480px]:grid-cols-[3rem_minmax(0,1fr)]'>
      <Badge className='mt-0.5 justify-center'>{language}</Badge>
      <p className='m-0 text-base/snug font-medium wrap-anywhere text-card-foreground max-[480px]:text-sm'>
        {text}
      </p>
    </div>
  );
}
