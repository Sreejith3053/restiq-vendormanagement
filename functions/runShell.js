const cp = require('child_process');

const p = cp.spawn('firebase', ['functions:shell'], { shell: true });

let triggered = false;

p.stdout.on('data', d => {
    const out = d.toString();
    process.stdout.write(out);
    if ((out.includes('firebase >') || out.includes('>')) && !triggered) {
        triggered = true;
        console.log("Triggering engine now...");
        p.stdin.write("triggerForecastEngine.call({}).then(() => { console.log('✅ ENGINE FINISHED'); process.exit(0); }).catch(e => { console.error('❌ ENGINE ERROR', e); process.exit(1); })\n");
    }
});

p.stderr.on('data', d => process.stderr.write(d.toString()));
