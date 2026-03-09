const cp = require('child_process');

const p = cp.spawn('firebase', ['functions:shell'], { shell: true });

let triggered = false;

p.stdout.on('data', d => {
    const out = d.toString();
    process.stdout.write(out);
    if ((out.includes('firebase >') || out.includes('>')) && !triggered) {
        triggered = true;
        console.log("Triggering price update now...");
        p.stdin.write("triggerPriceUpdate.call({}).then(() => { console.log('✅ SEED FINISHED'); setTimeout(() => process.exit(0), 1000); }).catch(e => { console.error('❌ SEED ERROR', e); process.exit(1); })\n");
    }
});

p.stderr.on('data', d => {
    process.stderr.write(d.toString());
});
