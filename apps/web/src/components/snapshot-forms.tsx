'use client';

import { useActionState } from 'react';
import { Camera } from 'lucide-react';
import { saveValuationSnapshotAction } from '@/app/actions';
import type { FormState } from '@/lib/contracts';
import { FormFeedback, SubmitButton } from './form-controls';

export function SaveSnapshotButton({ organizationId }: { organizationId: string }) {
  const [state, action] = useActionState(saveValuationSnapshotAction, {} as FormState);
  return (
    <form action={action} className="row-action-form">
      <input type="hidden" name="organizationId" value={organizationId} />
      <FormFeedback state={state} />
      <SubmitButton pendingText="Saving...">
        <Camera size={16} aria-hidden="true" />
        Save snapshot
      </SubmitButton>
    </form>
  );
}
