const withTechnicalDetail = (guidance: string, detail: string) =>
  `${guidance} Technical detail: ${detail}`;

export function explainTransformersJsError(message: string) {
  const detail = message.trim();
  if (!detail) return 'The Transformers.js worker failed.';

  if (
    /quotaexceedederror|quota (?:has been )?exceeded|storage quota/i.test(
      detail,
    )
  )
    return withTechnicalDetail(
      "The browser does not have enough site storage for the model. Free some disk space or clear this site's cached data, then retry. Clearing site data will require the model files to be downloaded again.",
      detail,
    );

  if (
    /std::bad_alloc|out[_ -]?of[_ -]?memory|cannot allocate memory|failed to allocate|memory allocation (?:failed|failure)|\boom\b/i.test(
      detail,
    )
  )
    return withTechnicalDetail(
      'The selected model could not fit in the memory available to this browser. Fully quit other model tabs and GPU-heavy apps, then retry in a current Chrome or Edge browser. If the 1.7B model still fails, use the 0.6B model.',
      detail,
    );

  if (
    /device (?:was |has been )?lost|lost.*(?:gpu )?device|gpu process.*(?:crash|exit)|context lost|object has already been disposed/i.test(
      detail,
    )
  )
    return withTechnicalDetail(
      "The browser lost access to the GPU while running the model. Save any text you need, fully quit and reopen the browser, then load the model again. If it repeats, check the browser's GPU diagnostics and try the 0.6B model.",
      detail,
    );

  if (
    /failed to fetch|fetch failed|networkerror|network error|err_(?:internet|network|connection)|cross-origin request blocked/i.test(
      detail,
    )
  )
    return withTechnicalDetail(
      'The model files could not be downloaded. Check your connection and whether a content blocker, firewall, or network policy is blocking huggingface.co, then retry. Already cached model files can remain.',
      detail,
    );

  if (
    /maxbuffersize|maxstoragebufferbindingsize|binding size.*limit|buffer size.*(?:exceeds|larger)/i.test(
      detail,
    )
  )
    return withTechnicalDetail(
      'The selected model exceeds a WebGPU limit reported by this GPU or browser. Retry in a current Chrome or Edge browser, or use the 0.6B model.',
      detail,
    );

  return detail;
}
