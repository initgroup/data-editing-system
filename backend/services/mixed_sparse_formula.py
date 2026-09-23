"""Bounded TRAIN_FIT-only screening of sparse unit-coefficient identities.

Pair screening uses a shared small Gram matrix rather than fitting every pair.
Only a fixed-width beam expands to three/four terms; the returned candidates must
still pass full fitting, separate tolerance calibration and validation elsewhere.
"""
from __future__ import annotations

import numpy as np


UNIT_SAMPLE_ROWS = 256
UNIT_BEAM_WIDTH = 12
UNIT_CANDIDATE_LIMIT = 8


class UnitFormulaScreen:
    def __init__(self, numeric, indices):
        self.names = list(numeric)
        indices = np.asarray(indices, dtype=int)
        sample = indices[np.linspace(0, len(indices) - 1, min(UNIT_SAMPLE_ROWS, len(indices)), dtype=int)]
        self.values = np.column_stack([numeric[name][sample] for name in self.names])
        filled = self.values.copy()
        for index in range(len(self.names)):
            present = filled[:, index][np.isfinite(filled[:, index])]
            filled[~np.isfinite(filled[:, index]), index] = np.median(present) if len(present) else 0.
        centered = filled.copy()
        centered -= centered.mean(axis=0)
        self.centered = centered
        self.gram = centered.T @ centered / max(1, len(centered))
        self._pairs = {}

    def _error(self, target, terms):
        predicted = sum(sign * self.values[:, index] for index, sign in terms)
        actual = self.values[:, target]
        keep = np.isfinite(actual) & np.isfinite(predicted)
        if keep.sum() < 20:
            return float("inf")
        residual = actual[keep] - predicted[keep]
        residual -= np.median(residual)
        scale = float(np.quantile(actual[keep], .75) - np.quantile(actual[keep], .25))
        return float(np.quantile(np.abs(residual), .9)) / max(scale, 1e-20)

    def _quadratic_error(self, target, terms):
        indices, signs = zip(*terms)
        signs = np.asarray(signs)
        cross = self.gram[np.ix_(indices, indices)]
        return float(self.gram[target, target] - 2 * self.gram[target, list(indices)] @ signs + signs @ cross @ signs)

    def pairs(self, target_name):
        if target_name in self._pairs:
            return self._pairs[target_name]
        target = self.names.index(target_name)
        diagonal = np.diag(self.gram)
        upper = np.triu(np.ones(self.gram.shape, dtype=bool), 1)
        upper[target, :] = False
        upper[:, target] = False
        first, second = np.where(upper)
        if not len(first):
            self._pairs[target_name] = []
            return []
        gram_choices = [self.gram]
        actual = self.values[:, target]
        finite = actual[np.isfinite(actual)]
        center = float(np.median(finite)) if len(finite) else 0.
        spread = float(np.quantile(finite, .75) - np.quantile(finite, .25)) if len(finite) else 0.
        central = np.isfinite(actual) & (np.abs(actual - center) <= 10 * spread)
        if spread > 0 and central.sum() >= 30 and np.any(np.abs(finite - center) > 20 * spread):
            # Select whole training rows; clipping individual columns would
            # destroy the sum being sought. Full cohorts still judge the rule.
            subset = self.centered[central].copy()
            subset -= subset.mean(axis=0)
            gram_choices.append(subset.T @ subset / len(subset))
        shortlisted = set()
        for gram in gram_choices:
            scored = []
            for left_sign, right_sign in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
                errors = (gram[target, target] + np.diag(gram)[first] + np.diag(gram)[second]
                          + 2 * left_sign * right_sign * gram[first, second]
                          - 2 * left_sign * gram[target, first] - 2 * right_sign * gram[target, second])
                count = min(len(errors), UNIT_BEAM_WIDTH * 2)
                selected = np.argpartition(errors, count - 1)[:count]
                scored.extend((float(errors[i]), ((int(first[i]), left_sign), (int(second[i]), right_sign))) for i in selected)
            scored.sort(key=lambda item: item[0])
            shortlisted.update(terms for _, terms in scored[:UNIT_BEAM_WIDTH * 3])
        # When Y and B are huge but C is small, expanding (Y-B-C)^2 as
        # Gram terms loses C to cancellation. Direct residual anchors preserve
        # those small components without evaluating all pairs row by row.
        denominator = np.sqrt(np.maximum(diagonal, 1e-300)) * max(float(np.sqrt(diagonal[target])), 1e-150)
        correlations = np.abs(gram_choices[-1][target]) / denominator
        correlations[target] = -1
        anchors = np.argsort(correlations)[-min(4, len(self.names) - 1):]
        for anchor in anchors:
            for anchor_sign in (1, -1):
                residual = self.centered[:, target] - anchor_sign * self.centered[:, anchor]
                for other_sign in (1, -1):
                    errors = np.mean((residual[:, None] - other_sign * self.centered) ** 2, axis=0)
                    errors[[target, anchor]] = np.inf
                    count = min(3, len(self.names) - 2)
                    if count:
                        for other in np.argpartition(errors, count - 1)[:count]:
                            shortlisted.add(tuple(sorted(((int(anchor), anchor_sign), (int(other), other_sign)))))
        candidates = [(self._error(target, terms), terms) for terms in shortlisted]
        candidates.sort(key=lambda item: (item[0], item[1]))
        self._pairs[target_name] = candidates
        return candidates

    def priority(self, target_name):
        pairs = self.pairs(target_name)
        return pairs[0][0] if pairs else float("inf")

    def candidates(self, target_name, max_terms=4):
        if max_terms < 2:
            return []
        target = self.names.index(target_name)
        pairs = self.pairs(target_name)
        all_candidates = list(pairs)
        beam = pairs[:UNIT_BEAM_WIDTH]
        for _size in range(3, min(max_terms, 4) + 1):
            expanded = {}
            for _, terms in beam:
                used = {target, *(index for index, _ in terms)}
                indices, signs = zip(*terms)
                baseline = self._quadratic_error(target, terms)
                for sign in (1, -1):
                    errors = (baseline + np.diag(self.gram) + 2 * sign *
                              (np.asarray(signs) @ self.gram[list(indices), :] - self.gram[target, :]))
                    for index in used:
                        errors[index] = np.inf
                    count = min(4, len(self.names) - len(used))
                    if not count:
                        continue
                    for index in np.argpartition(errors, count - 1)[:count]:
                        candidate = tuple(sorted((*terms, (int(index), sign))))
                        expanded[candidate] = float(errors[index])
            short_list = sorted(expanded, key=expanded.get)[:UNIT_BEAM_WIDTH * 3]
            beam = sorted(((self._error(target, terms), terms) for terms in short_list), key=lambda item: (item[0], item[1]))[:UNIT_BEAM_WIDTH]
            all_candidates.extend(beam)
        all_candidates.sort(key=lambda item: (item[0], len(item[1]), item[1]))
        return [{"names": [self.names[index] for index, _ in terms],
                 "coefficients": [sign for _, sign in terms], "screenError": error}
                for error, terms in all_candidates[:UNIT_CANDIDATE_LIMIT] if np.isfinite(error) and error <= .2]
