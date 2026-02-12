import type React from 'react';

/**
 * Tokenize a single line of formatted JSON into colored spans.
 * Handles keys, string values, numbers, booleans, null, and punctuation.
 */
export function highlightJson(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = line;
  let key = 0;

  while (remaining.length > 0) {
    // Leading whitespace
    const wsMatch = remaining.match(/^(\s+)/);
    if (wsMatch) {
      nodes.push(<span key={key++}>{wsMatch[1]}</span>);
      remaining = remaining.slice(wsMatch[1].length);
      continue;
    }

    // Key: "something":
    const keyMatch = remaining.match(/^("(?:[^"\\]|\\.)*")\s*:/);
    if (keyMatch) {
      nodes.push(
        <span key={key++} style={{ color: 'var(--json-key)' }}>
          {keyMatch[1]}
        </span>,
      );
      nodes.push(<span key={key++} style={{ color: 'var(--text-secondary)' }}>: </span>);
      remaining = remaining.slice(keyMatch[0].length);
      // Trim any space after the colon that was already added
      remaining = remaining.replace(/^\s/, '');
      continue;
    }

    // String value: "something" possibly followed by comma
    const strMatch = remaining.match(/^("(?:[^"\\]|\\.)*")(,?)/);
    if (strMatch) {
      nodes.push(
        <span key={key++} style={{ color: 'var(--json-string)' }}>
          {strMatch[1]}
        </span>,
      );
      if (strMatch[2]) {
        nodes.push(
          <span key={key++} style={{ color: 'var(--text-secondary)' }}>
            {strMatch[2]}
          </span>,
        );
      }
      remaining = remaining.slice(strMatch[0].length);
      continue;
    }

    // Boolean true
    const trueMatch = remaining.match(/^(true)(,?)/);
    if (trueMatch) {
      nodes.push(
        <span key={key++} style={{ color: 'var(--json-boolean-true)' }}>
          {trueMatch[1]}
        </span>,
      );
      if (trueMatch[2]) {
        nodes.push(
          <span key={key++} style={{ color: 'var(--text-secondary)' }}>
            {trueMatch[2]}
          </span>,
        );
      }
      remaining = remaining.slice(trueMatch[0].length);
      continue;
    }

    // Boolean false
    const falseMatch = remaining.match(/^(false)(,?)/);
    if (falseMatch) {
      nodes.push(
        <span key={key++} style={{ color: 'var(--json-boolean-false)' }}>
          {falseMatch[1]}
        </span>,
      );
      if (falseMatch[2]) {
        nodes.push(
          <span key={key++} style={{ color: 'var(--text-secondary)' }}>
            {falseMatch[2]}
          </span>,
        );
      }
      remaining = remaining.slice(falseMatch[0].length);
      continue;
    }

    // Null
    const nullMatch = remaining.match(/^(null)(,?)/);
    if (nullMatch) {
      nodes.push(
        <span key={key++} style={{ color: 'var(--text-muted)' }}>
          {nullMatch[1]}
        </span>,
      );
      if (nullMatch[2]) {
        nodes.push(
          <span key={key++} style={{ color: 'var(--text-secondary)' }}>
            {nullMatch[2]}
          </span>,
        );
      }
      remaining = remaining.slice(nullMatch[0].length);
      continue;
    }

    // Number
    const numMatch = remaining.match(/^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(,?)/);
    if (numMatch) {
      nodes.push(
        <span key={key++} style={{ color: 'var(--json-number)' }}>
          {numMatch[1]}
        </span>,
      );
      if (numMatch[2]) {
        nodes.push(
          <span key={key++} style={{ color: 'var(--text-secondary)' }}>
            {numMatch[2]}
          </span>,
        );
      }
      remaining = remaining.slice(numMatch[0].length);
      continue;
    }

    // Braces, brackets, punctuation
    const punctMatch = remaining.match(/^([{}[\],:])/);
    if (punctMatch) {
      nodes.push(
        <span key={key++} style={{ color: 'var(--text-secondary)' }}>
          {punctMatch[1]}
        </span>,
      );
      remaining = remaining.slice(1);
      continue;
    }

    // Fallback: consume one character
    nodes.push(<span key={key++}>{remaining[0]}</span>);
    remaining = remaining.slice(1);
  }

  return nodes;
}
