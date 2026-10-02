/**
 * ImageUploader — 拖拽 / 多选参考图上传
 */
import {Upload, message} from 'antd';
import {InboxOutlined} from '@ant-design/icons';
import type {UploadFile, UploadProps} from 'antd';
import {useEffect, useState} from 'react';

interface Props {
  value?: string[];
  onChange?: (imageSourceList: string[]) => void;
  max?: number;
}

const MAX_FILE_SIZE = 8 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function toPreviewUrl(value: string) {
  if (!value) return undefined;
  if (value.startsWith('data:') || /^https?:\/\//i.test(value)) return value;
  if (value.startsWith('iVBOR')) return `data:image/png;base64,${value}`;
  if (value.startsWith('/9j/')) return `data:image/jpeg;base64,${value}`;
  return undefined;
}

export function ImageUploader({value = [], onChange, max = 6}: Props) {
  const [fileList, setFileList] = useState<UploadFile[]>(() =>
    value.map((imageSource, index) => ({
      uid: `reference-${index}`,
      name: `reference-${index + 1}`,
      status: 'done',
      url: toPreviewUrl(imageSource),
      response: imageSource,
    })),
  );

  useEffect(() => {
    if (value.length === 0) setFileList([]);
  }, [value.length]);

  const handleChange: UploadProps['onChange'] = async ({fileList: nextList}) => {
    const limited = nextList.slice(0, max);
    if (nextList.length > max) {
      message.warning(`最多上传 ${max} 张参考图`);
    }

    const resolved = await Promise.all(
      limited.map(async (file) => {
        if (typeof file.response === 'string') return file;
        if (file.originFileObj instanceof File) {
          const dataUrl = await fileToDataUrl(file.originFileObj);
          return {...file, url: dataUrl, response: dataUrl};
        }
        const dataUrl = file.url ?? file.thumbUrl;
        return {...file, response: dataUrl?.startsWith('data:') ? dataUrl : ''};
      }),
    );

    setFileList(resolved);
    onChange?.(
      resolved
        .map((file) => (typeof file.response === 'string' ? file.response : ''))
        .filter(Boolean),
    );
  };

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      message.error(`${file.name} 仅支持 PNG / JPG 格式`);
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_FILE_SIZE) {
      message.error(`${file.name} 超过 8MB`);
      return Upload.LIST_IGNORE;
    }
    return false;
  };

  return (
    <Upload.Dragger
      listType="picture-card"
      fileList={fileList}
      onChange={handleChange}
      beforeUpload={beforeUpload}
      multiple
      accept="image/png,image/jpeg"
      style={{width: '100%'}}
    >
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">拖拽或点击上传参考图</p>
      <p className="ant-upload-hint">
        支持 PNG / JPG，单张不超过 8MB，最多 {max} 张
      </p>
    </Upload.Dragger>
  );
}
