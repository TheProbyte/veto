export default function Home() {
  const go = () => { const c = Math.random().toString(36).slice(2, 7).toUpperCase(); location.href = `/r/${c}`; };
  return <div className="home"><h1>Nah.</h1><button onClick={go}>Open a table</button></div>;
}
