async function runTest() {
  try {
    const res = await fetch('http://localhost:5173/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'facebook/react',
        query: 'What is React?',
        stream: false,
      }),
    });
    const data = await res.json();
    console.log('Status:', res.status, data);
  } catch (err) {
    console.error('Test failed:', err);
  }
}

runTest();
