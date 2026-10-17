async function testMemory() {
  console.log('--- GitStory AI Conversation Memory Test ---');
  // 1. Create conversation
  const createRes = await fetch('http://localhost:5173/api/ai/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: 'facebook/react', title: 'Memory Integration Test' }),
  });
  const createData = await createRes.json();
  const convId = createData.conversation.id;
  console.log('1. Created Conversation ID:', convId);

  // 2. First turn
  console.log('2. Sending first question...');
  const res1 = await fetch('http://localhost:5173/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: 'facebook/react',
      conversationId: convId,
      query: 'What is the primary language and purpose of facebook/react?',
      stream: false,
    }),
  });
  const data1 = await res1.json();
  console.log('First answer preview:', data1.message?.content?.slice(0, 150));

  // 3. Follow-up turn referencing earlier message
  console.log('3. Sending follow-up referencing prior answer...');
  const res2 = await fetch('http://localhost:5173/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo: 'facebook/react',
      conversationId: convId,
      query: 'Based on what you just answered, repeat just the primary language in 3 words.',
      stream: false,
    }),
  });
  const data2 = await res2.json();
  console.log('Follow-up answer:\n', data2.message?.content);

  // 4. Verify conversation retrieval from database
  const getRes = await fetch(`http://localhost:5173/api/ai/conversations/${convId}`);
  const getData = await getRes.json();
  console.log('4. Total messages stored in DB:', getData.conversation?.messages?.length);
  console.log('--- Memory Test Complete ---');
}

testMemory();
