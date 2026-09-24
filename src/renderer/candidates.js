'use strict';

/**
 * What the window does with a candidate.
 *
 * Every row the screens can act on arrives as a candidate -- see
 * `src/main/analyzers/contract.js` -- with its verdict, confidence and ranked
 * evidence already checked by the main process. The screens were written
 * against flatter records (`file.size`, `file.reason`), and this is the one
 * place that projection is made, so a screen never builds a row from anything
 * but a candidate that passed validation.
 */
(function (root) {
  /** The row a screen draws, from the candidate it came from. */
  function candidateView(candidate) {
    return {
      ...candidate.meta,
      id: candidate.id,
      path: candidate.path,
      size: candidate.bytes,
      category: candidate.category,
      verdict: candidate.verdict,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
      // The deciding fact, which is what a one-line row has room for.
      reason: candidate.evidence[0] || null,
      actions: candidate.actions,
    };
  }

  /** id -> view, for the screens whose summaries refer to candidates by id. */
  function indexCandidates(candidates) {
    const byId = new Map();
    for (const candidate of candidates || []) byId.set(candidate.id, candidateView(candidate));
    return byId;
  }

  /** Resolve a list of ids, dropping any the main process did not send. */
  function viewsOf(ids, byId) {
    const out = [];
    for (const id of ids || []) {
      const view = byId.get(id);
      if (view) out.push(view);
    }
    return out;
  }

  /**
   * The confidence as the screens say it.
   *
   * The same four words the photo screen has always used, so the app has one
   * vocabulary for how sure it is.
   */
  function confidenceWord(confidence) {
    switch (confidence) {
      case 'certain': return t('confidence.certain', 'certain');
      case 'strong': return t('confidence.strong', 'strong evidence');
      case 'likely': return t('confidence.likely', 'likely');
      default: return t('confidence.guess', 'a guess');
    }
  }

  root.candidateView = candidateView;
  root.indexCandidates = indexCandidates;
  root.viewsOf = viewsOf;
  root.confidenceWord = confidenceWord;
})(window);
