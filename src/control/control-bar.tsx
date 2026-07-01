import {
  EyeIcon,
  EyeOffIcon,
  FileDownIcon,
  LoaderCircleIcon,
  LogOutIcon,
  PlayIcon,
  SquareIcon,
} from 'lucide-react';
import { siGithub } from 'simple-icons';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { isRelayActive } from '@/shared/status';
import type { RelayState } from '@/shared/types';

interface ControlBarProps {
  state: RelayState;
  onOpenRepository: () => void;
  onQuit: () => void;
  onSaveTranscripts: () => void;
  onToggleOverlay: () => void;
  onToggleRelay: (checked: boolean) => void;
}

export function ControlBar({
  state,
  onOpenRepository,
  onQuit,
  onSaveTranscripts,
  onToggleOverlay,
  onToggleRelay,
}: ControlBarProps) {
  const isActive = isRelayActive(state.status);
  const isConnecting = state.status === 'connecting';
  const hasAudioSource = state.settings.microphone || state.settings.systemAudio;
  const overlayVisible = state.overlayVisible;
  const OverlayIcon = overlayVisible ? EyeOffIcon : EyeIcon;
  const ToggleIcon =
    state.status === 'connecting' ? LoaderCircleIcon : isActive ? SquareIcon : PlayIcon;
  const toggleText = state.status === 'connecting' ? 'Connecting' : isActive ? 'Stop' : 'Start';
  const toggleVariant = isActive ? 'outline' : 'default';
  const missingApiKey = !state.apiKey.hasApiKey && !isActive;
  const missingAudioSource = !hasAudioSource && !isActive;
  const toggleDisabled = isConnecting || missingApiKey || missingAudioSource;
  const toggleDisabledReason = missingApiKey
    ? 'Enter an API key to start.'
    : missingAudioSource
      ? 'Enable microphone, system audio, or both.'
      : null;
  const toggleButton = (
    <Button
      className={cn(toggleDisabled && 'cursor-not-allowed')}
      disabled={toggleDisabled}
      size='sm'
      type='button'
      variant={toggleVariant}
      onClick={() => {
        onToggleRelay(!isActive);
      }}
    >
      <ToggleIcon className={cn(isConnecting && 'animate-spin')} data-icon='inline-start' />
      {toggleText}
    </Button>
  );

  return (
    <div className='flex w-full flex-wrap items-center justify-start gap-2'>
      {toggleDisabledReason ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<span className='inline-flex cursor-not-allowed' />}>
              {toggleButton}
            </TooltipTrigger>
            <TooltipContent>{toggleDisabledReason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        toggleButton
      )}
      <Button
        disabled={isConnecting}
        size='sm'
        type='button'
        variant='outline'
        onClick={onToggleOverlay}
      >
        <OverlayIcon data-icon='inline-start' />
        {overlayVisible ? 'Hide overlay' : 'Show overlay'}
      </Button>
      <Button
        disabled={isConnecting}
        size='sm'
        type='button'
        variant='outline'
        onClick={onSaveTranscripts}
      >
        <FileDownIcon data-icon='inline-start' />
        Save transcripts
      </Button>
      <Button
        aria-label='Open GitHub repository'
        className='ml-auto'
        disabled={isConnecting}
        size='icon-sm'
        type='button'
        variant='outline'
        onClick={onOpenRepository}
      >
        <svg aria-hidden='true' data-icon='inline-start' focusable='false' viewBox='0 0 24 24'>
          <path d={siGithub.path} fill='currentColor' />
        </svg>
      </Button>
      <Button
        aria-label='Quit'
        disabled={isConnecting}
        size='icon-sm'
        type='button'
        variant='destructive'
        onClick={onQuit}
      >
        <LogOutIcon data-icon='inline-start' />
      </Button>
    </div>
  );
}
