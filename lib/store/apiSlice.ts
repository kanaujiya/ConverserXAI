import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  endpoints: (builder) => ({
    createStreamSession: builder.mutation<
      {
        id: string;
        session_id: string;
        offer: RTCSessionDescriptionInit;
        ice_servers: RTCIceServer[];
      },
      void
    >({
      query: () => ({
        url: '/avatar/stream',
        method: 'POST',
      }),
    }),
    submitIceCandidate: builder.mutation<
      void,
      { streamId: string; sessionId: string; candidate: unknown; sdpMid: string; sdpMLineIndex: number }
    >({
      query: ({ streamId, sessionId, ...body }) => ({
        url: '/avatar/stream/ice',
        method: 'POST',
        body: { streamId, sessionId, ...body },
      }),
    }),
    submitSdpAnswer: builder.mutation<
      void,
      { streamId: string; sessionId: string; answer: unknown }
    >({
      query: ({ streamId, sessionId, ...body }) => ({
        url: '/avatar/stream/sdp',
        method: 'POST',
        body: { streamId, sessionId, ...body },
      }),
    }),
    submitTalk: builder.mutation<void, { streamId: string; sessionId: string; text: string }>({
      query: (body) => ({
        url: '/avatar/stream/talk',
        method: 'POST',
        body,
      }),
    }),
    closeStreamSession: builder.mutation<void, { streamId: string; sessionId: string }>({
      query: (body) => ({
        url: '/avatar/stream',
        method: 'DELETE',
        body,
      }),
    }),
  }),
});

export const {
  useCreateStreamSessionMutation,
  useSubmitIceCandidateMutation,
  useSubmitSdpAnswerMutation,
  useSubmitTalkMutation,
  useCloseStreamSessionMutation,
} = apiSlice;
