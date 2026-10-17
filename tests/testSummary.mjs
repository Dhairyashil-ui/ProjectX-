async function testSummary() {
  const res = await fetch('http://localhost:5173/api/ai/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: 'facebook/react',
      scope: 'repo',
    }),
  });
  const data = await res.json();
  console.log('Summary Status:', res.status);
  console.log('Scope:', data.scope);
  console.log('Key files analyzed:', data.keyFiles);
  console.log('Summary Preview:\n', data.summary?.slice(0, 400));
}

testSummary();
