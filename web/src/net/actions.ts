import type { Flow } from '@proto/flow';
import { curlOf } from '../lib/curl';
import { isHttp } from '../lib/flow';
import { useUi } from '../store/ui';

export function replay(r: Flow): void {
  if (!isHttp(r)) {
    alert('Only HTTP/HTTPS requests can be resent.');
    return;
  }
  useUi.getState().runCurl(curlOf(r)).catch((e) => alert((e as Error).message));
}

export function editAndResend(r: Flow): void {
  useUi.getState().openCurl(curlOf(r));
}
